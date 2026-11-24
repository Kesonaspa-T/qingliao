// 轻聊 · 免安装单文件启动器（.NET Framework 4.x，Win10/11 自带）
//
// 做什么：自己是那个「轻聊.exe」。真正的 Electron 运行时和窗口代码以 ZIP 形式追加在
// 本 exe 末尾。第一次双击时解压到 %LOCALAPPDATA%\轻聊\app，然后启动里面的 轻聊.exe；
// 之后再双击直接启动，不再解压。
//
// 为什么不用 electron-builder 的 portable：那台打包机连不上 npm，下不了 NSIS。
// 有网络时请用 `npm run dist`，产物同样是单文件，不需要这个启动器。

using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

static class Launcher
{
    const string AppDirName = "轻聊";
    const string InnerExe = "轻聊.exe";
    const string Marker = "payload.stamp";

    [STAThread]
    static int Main(string[] args)
    {
        string self = Assembly.GetExecutingAssembly().Location;
        long payloadLen;
        try { payloadLen = ReadPayloadLength(self); }
        catch (Exception e) { Fail("这个 exe 不完整（读不到压缩包）：\n" + e.Message); return 1; }

        string root;
        try { root = ResolveRoot(self); }
        catch (Exception e) { Fail("找不到能解压的位置：\n" + e.Message); return 1; }
        string appDir = Path.Combine(root, "app");
        string stamp = Path.Combine(root, Marker);
        string stampValue = payloadLen.ToString() + ":" + new FileInfo(self).LastWriteTimeUtc.Ticks.ToString();
        string logPath = Path.Combine(root, "launcher.log");

        Log(logPath, "=== 启动 ===");
        Log(logPath, "exe      = " + self);
        Log(logPath, "payload  = " + payloadLen + " 字节");
        Log(logPath, "数据目录 = " + root);
        Log(logPath, "系统     = " + Environment.OSVersion);
        Log(logPath, ".NET     = " + Environment.Version);

        bool needExtract;
        try { needExtract = File.ReadAllText(stamp, Encoding.UTF8).Trim() != stampValue; }
        catch { needExtract = true; }
        if (needExtract && !File.Exists(Path.Combine(appDir, InnerExe))) needExtract = true;
        Log(logPath, "需要解压 = " + needExtract);

        if (needExtract)
        {
            using (var gate = new Mutex(false, "qingliao-win-extract"))
            {
                bool owned = false;
                try { owned = gate.WaitOne(TimeSpan.FromMinutes(10)); }
                catch (AbandonedMutexException) { owned = true; }
                if (!owned) { Fail("另一个轻聊正在启动，稍等再试。"); return 1; }

                // 另一个实例可能已经解压完了
                try
                {
                    if (File.ReadAllText(stamp, Encoding.UTF8).Trim() == stampValue) needExtract = false;
                }
                catch { }

                if (needExtract)
                {
                    try
                    {
                        if (Directory.Exists(appDir)) Directory.Delete(appDir, true);
                        Directory.CreateDirectory(root);
                        Log(logPath, "开始解压 → " + appDir);
                        ExtractWithProgress(self, payloadLen, appDir);
                        File.WriteAllText(stamp, stampValue, new UTF8Encoding(false));
                        Log(logPath, "解压完成");
                    }
                    catch (Exception e)
                    {
                        Log(logPath, "解压失败: " + e);
                        Fail("解压失败：\n" + e.Message + "\n\n日志：" + logPath);
                        return 1;
                    }
                }
                if (owned) gate.ReleaseMutex();
            }
        }

        string exe = Path.Combine(appDir, InnerExe);
        if (!File.Exists(exe)) { Fail("找不到 " + exe + "\n\n日志：" + logPath); return 1; }

        // .NET Framework 没有 ProcessStartInfo.ArgumentList，手动拼（都要加引号）
        var sb = new StringBuilder();
        foreach (string a in args)
        {
            if (sb.Length > 0) sb.Append(' ');
            sb.Append('"').Append(a.Replace("\"", "\\\"")).Append('"');
        }

        // %APPDATA% 写不了时（受限环境）Electron 会直接退出、什么都不显示，
        // 所以先探一下；写不了就把 userData 也放到我们的数据目录里。
        if (sb.Length == 0 && !CanWriteProfile())
        {
            string ud = Path.Combine(root, "userdata");
            try
            {
                Directory.CreateDirectory(ud);
                sb.Append('"').Append("--user-data-dir=" + ud).Append('"');
                Log(logPath, "%APPDATA% 不可写，改用 userData = " + ud);
            }
            catch (Exception e) { Log(logPath, "改用 userData 失败: " + e.Message); }
        }

        Log(logPath, "启动: " + exe + " " + sb);
        int childCode;
        bool exitedEarly;
        try
        {
            var psi = new ProcessStartInfo(exe, sb.ToString())
            {
                UseShellExecute = false,
                WorkingDirectory = appDir,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            using (var proc = new Process())
            {
                proc.StartInfo = psi;
                proc.OutputDataReceived += (s, e) => { if (e.Data != null) Log(logPath, "  out| " + e.Data); };
                proc.ErrorDataReceived += (s, e) => { if (e.Data != null) Log(logPath, "  err| " + e.Data); };
                proc.Start();
                proc.BeginOutputReadLine();
                proc.BeginErrorReadLine();

                // 10 秒还活着就认为起来了（Electron 正常启动后不会退）
                exitedEarly = proc.WaitForExit(10000);
                childCode = exitedEarly ? proc.ExitCode : 0;
            }
        }
        catch (Exception e)
        {
            Log(logPath, "拉起失败: " + e);
            Fail("轻聊没能启动：\n" + e.Message + "\n\n日志：" + logPath);
            return 1;
        }

        if (exitedEarly)
        {
            Log(logPath, "内层进程提前退出，退出码 = " + childCode);
            string tail = Tail(logPath, 24);
            string hint;
            if (childCode == 0)
            {
                hint = "退出码 0 通常表示「已经有一个轻聊在运行」。如果屏幕上看不到窗口，"
                     + "请在任务管理器里结束所有「轻聊.exe」后重试。";
            }
            else if (childCode == -2147483645) // 0x80000003 STATUS_BREAKPOINT
            {
                hint = "退出码 0x80000003 是 Chromium 的 CHECK 失败：系统不让它创建进程间通道。\n"
                     + "常见于被沙箱 / 安全软件限制的环境——例如直接在 AI 助手的界面里点开这个 exe。\n"
                     + "请把 exe 复制到桌面，用「资源管理器」双击运行。";
            }
            else if (childCode == -1073741502) // 0xC0000142
            {
                hint = "退出码 0xC0000142 是 DLL 初始化失败，通常是运行库缺失或被安全软件拦截。";
            }
            else
            {
                hint = "退出码 " + childCode + "（0x" + (childCode & 0xFFFFFFFF).ToString("X8") + "）说明 Electron 没能初始化。";
            }
            bool restricted = !root.StartsWith(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                StringComparison.OrdinalIgnoreCase);
            Fail("轻聊没起来（退出码 " + childCode + "）。\n\n" + hint
                 + "\n\n数据目录：" + root
                 + (restricted ? "\n（注意：数据目录不在 %APPDATA% 下，说明当前是受限环境运行）" : "")
                 + "\n\n日志：" + logPath + "\n\n最后几行：\n" + tail);
            return 1;
        }

        Log(logPath, "已启动，启动器退出");
        return 0;
    }

    static void Log(string path, string line)
    {
        try
        {
            File.AppendAllText(path,
                DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + "  " + line + Environment.NewLine,
                new UTF8Encoding(false));
        }
        catch { }
    }

    static string Tail(string path, int lines)
    {
        try
        {
            string[] all = File.ReadAllLines(path, Encoding.UTF8);
            int from = Math.Max(0, all.Length - lines);
            var sb = new StringBuilder();
            for (int i = from; i < all.Length; i++) sb.AppendLine(all[i]);
            return sb.ToString().Trim();
        }
        catch (Exception e) { return "(读不到日志: " + e.Message + ")"; }
    }

    /// 探一下 %APPDATA%\轻聊 能不能写（Electron 的默认 userData）
    static bool CanWriteProfile()
    {
        try
        {
            string dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), AppDirName);
            Directory.CreateDirectory(dir);
            string probe = Path.Combine(dir, "." + Guid.NewGuid().ToString("N") + ".probe");
            File.WriteAllText(probe, "ok");
            File.Delete(probe);
            return true;
        }
        catch { return false; }
    }

    /// 解压到哪：优先 %LOCALAPPDATA%\轻聊；那里写不了（企业环境 / 权限异常）就退到
    /// %TEMP%\轻聊，再不行放到 exe 旁边。QINGLIAO_HOME 可以强制指定（调试/绿色部署用）。
    static string ResolveRoot(string self)
    {
        var candidates = new System.Collections.Generic.List<string>();
        string env = Environment.GetEnvironmentVariable("QINGLIAO_HOME");
        if (!string.IsNullOrEmpty(env)) candidates.Add(env);
        candidates.Add(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), AppDirName));
        candidates.Add(Path.Combine(Path.GetTempPath(), AppDirName));
        try
        {
            string here = Path.GetDirectoryName(self);
            if (!string.IsNullOrEmpty(here)) candidates.Add(Path.Combine(here, AppDirName + "-data"));
        }
        catch { }

        var errs = new StringBuilder();
        foreach (string c in candidates)
        {
            try
            {
                Directory.CreateDirectory(c);
                string probe = Path.Combine(c, "." + Guid.NewGuid().ToString("N") + ".probe");
                File.WriteAllText(probe, "ok");
                File.Delete(probe);
                return c;
            }
            catch (Exception e) { errs.AppendLine(c + "  →  " + e.GetType().Name); }
        }
        throw new IOException(errs.ToString());
    }

    static long ReadPayloadLength(string self)
    {
        using (var fs = new FileStream(self, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            if (fs.Length < 16) throw new InvalidDataException("文件太小");
            fs.Seek(-8, SeekOrigin.End);
            var buf = new byte[8];
            if (fs.Read(buf, 0, 8) != 8) throw new InvalidDataException("读不到尾部长度");
            long len = BitConverter.ToInt64(buf, 0);
            if (len <= 0 || len + 8 > fs.Length) throw new InvalidDataException("长度字段不合理");
            return len;
        }
    }

    static void ExtractWithProgress(string self, long payloadLen, string appDir)
    {
        var form = new Form
        {
            Text = "轻聊 · 首次启动",
            Width = 380, Height = 150,
            StartPosition = FormStartPosition.CenterScreen,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false, MinimizeBox = false,
            BackColor = System.Drawing.Color.FromArgb(0xF2, 0xF3, 0xF5),
        };
        var label = new Label
        {
            Text = "正在准备轻聊（只需这一次）…",
            AutoSize = false, Dock = DockStyle.Top, Height = 46,
            TextAlign = System.Drawing.ContentAlignment.MiddleCenter,
            Font = new System.Drawing.Font("Microsoft YaHei", 9.5f),
            ForeColor = System.Drawing.Color.FromArgb(0x33, 0x33, 0x33),
        };
        var bar = new ProgressBar
        {
            Style = ProgressBarStyle.Marquee, MarqueeAnimationSpeed = 28,
            Dock = DockStyle.Bottom, Height = 18,
        };
        var pad = new Panel { Dock = DockStyle.Fill, Padding = new Padding(26, 0, 26, 26) };
        pad.Controls.Add(bar);
        form.Controls.Add(pad);
        form.Controls.Add(label);

        Exception error = null;
        form.Shown += (s, e) =>
        {
            var t = new Thread(() =>
            {
                try
                {
                    // 直接从 exe 尾部的数据流里解压，**不落任何临时文件**：
                    // 有机器（杀软/受控文件夹访问）不允许往 %TEMP% 写文件，落盘会「访问被拒绝」。
                    using (var fs = new FileStream(self, FileMode.Open, FileAccess.Read, FileShare.Read))
                    {
                        fs.Seek(-payloadLen - 8, SeekOrigin.End);
                        using (var sub = new SubStream(fs, fs.Position, payloadLen))
                        using (var zip = new ZipArchive(sub, ZipArchiveMode.Read))
                        {
                            string root = Path.GetFullPath(appDir);
                            if (!root.EndsWith(Path.DirectorySeparatorChar.ToString())) root += Path.DirectorySeparatorChar;
                            var buf = new byte[1 << 16];
                            foreach (var entry in zip.Entries)
                            {
                                string name = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
                                if (string.IsNullOrEmpty(name)) continue;
                                string dest = Path.GetFullPath(Path.Combine(appDir, name));
                                if (!dest.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue; // 防 zip-slip
                                bool isDir = entry.FullName.EndsWith("/") || entry.FullName.EndsWith("\\");
                                if (isDir) { Directory.CreateDirectory(dest); continue; }
                                string parent = Path.GetDirectoryName(dest);
                                if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
                                using (var src = entry.Open())
                                using (var outFs = new FileStream(dest, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 16))
                                {
                                    int n;
                                    while ((n = src.Read(buf, 0, buf.Length)) > 0) outFs.Write(buf, 0, n);
                                }
                            }
                        }
                    }
                }
                catch (Exception ex) { error = ex; }
                finally
                {
                    try { form.BeginInvoke(new Action(() => form.Close())); } catch { }
                }
            });
            t.IsBackground = true;
            t.Start();
        };
        form.ShowDialog();
        if (error != null) throw error;
    }

    static void Fail(string msg)
    {
        MessageBox.Show(msg, "轻聊", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}

/// 把「文件中间的一段」当成一个独立的可 Seek 流，ZipArchive 就能直接读，
/// 不用先把 150MB 的包复制到临时目录。
sealed class SubStream : Stream
{
    readonly Stream inner;
    readonly long start;
    readonly long length;
    long pos;

    public SubStream(Stream inner, long start, long length)
    {
        this.inner = inner; this.start = start; this.length = length;
    }

    public override bool CanRead { get { return true; } }
    public override bool CanSeek { get { return true; } }
    public override bool CanWrite { get { return false; } }
    public override long Length { get { return length; } }

    public override long Position
    {
        get { return pos; }
        set
        {
            if (value < 0 || value > length) throw new IOException("越界");
            pos = value;
        }
    }

    public override int Read(byte[] buffer, int offset, int count)
    {
        if (pos >= length) return 0;
        inner.Position = start + pos;
        int n = inner.Read(buffer, offset, (int)Math.Min(count, length - pos));
        pos += n;
        return n;
    }

    public override long Seek(long offset, SeekOrigin origin)
    {
        long target;
        if (origin == SeekOrigin.Begin) target = offset;
        else if (origin == SeekOrigin.Current) target = pos + offset;
        else target = length + offset;
        if (target < 0 || target > length) throw new IOException("越界");
        pos = target;
        return pos;
    }

    public override void Flush() { }
    public override void SetLength(long value) { throw new NotSupportedException(); }
    public override void Write(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
}
