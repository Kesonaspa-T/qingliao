package com.qingliao.app;

import android.content.Context;
import android.webkit.JavascriptInterface;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;

/**
 * 把「登录态」存在 App 私有目录里，不再只依赖 WebView 的 localStorage。
 *
 * 手机 WebView 在系统空间紧张时会把 localStorage 整块清掉（它被视为可丢弃的缓存），
 * 表现就是「用着用着莫名其妙退出登录」「重新打开要重新登录」。
 * 这里只存几个很小的键（服务器地址、token、记住的账号），和 WebView 存储无关。
 */
public class SessionBridge {
    private final Context ctx;

    public SessionBridge(Context c) { this.ctx = c; }

    private File file() { return new File(ctx.getFilesDir(), "qingliao-session.json"); }

    @JavascriptInterface
    public String read() {
        File f = file();
        if (!f.exists()) return "";
        FileInputStream in = null;
        try {
            in = new FileInputStream(f);
            ByteArrayOutputStream out = new ByteArrayOutputStream((int) Math.max(256, f.length()));
            byte[] buf = new byte[16 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return new String(out.toByteArray(), "UTF-8");
        } catch (Exception e) {
            return "";
        } finally {
            try { if (in != null) in.close(); } catch (Exception ignored) {}
        }
    }

    @JavascriptInterface
    public boolean write(String json) {
        if (json == null) return false;
        File dst = file();
        File tmp = new File(ctx.getFilesDir(), "qingliao-session.json.tmp");
        FileOutputStream out = null;
        try {
            out = new FileOutputStream(tmp);
            out.write(json.getBytes("UTF-8"));
            out.flush();
            out.getFD().sync();
            out.close();
            out = null;
            if (tmp.renameTo(dst)) return true;
            if (dst.delete() && tmp.renameTo(dst)) return true;
            return false;
        } catch (Exception e) {
            return false;
        } finally {
            try { if (out != null) out.close(); } catch (Exception ignored) {}
        }
    }
}
