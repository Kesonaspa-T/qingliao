package com.qingliao.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.graphics.Color;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 网页和安卓之间的桥：流式请求、停止、复制、连通性测试、状态栏配色。
 */
public class Bridge {

    private final Context ctx;
    private final WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final HashMap<String, AtomicBoolean> cancels = new HashMap<String, AtomicBoolean>();

    Bridge(Context context, WebView webView) {
        this.ctx = context;
        this.web = webView;
    }

    /* ---------------- 聊天流 ---------------- */

    @JavascriptInterface
    public void start(final String id, final String url, final String key, final String body) {
        final AtomicBoolean flag = new AtomicBoolean(false);
        cancels.put(id, flag);
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                stream(id, url, key, body, flag);
            }
        });
        t.setDaemon(true);
        t.start();
    }

    @JavascriptInterface
    public void abort(String id) {
        AtomicBoolean flag = cancels.get(id);
        if (flag != null) flag.set(true);
    }

    private void stream(String id, String url, String key, String body, AtomicBoolean cancelled) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(180000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setRequestProperty("Authorization", "Bearer " + key);
            conn.setRequestProperty("Accept", "text/event-stream");

            byte[] payload = body.getBytes("UTF-8");
            conn.setFixedLengthStreamingMode(payload.length);
            OutputStream os = conn.getOutputStream();
            os.write(payload);
            os.flush();
            os.close();

            int code = conn.getResponseCode();
            if (code >= 400) {
                String detail = readAll(conn.getErrorStream());
                emit("QiaoqiaoNative.error(" + q(id) + "," + q(friendly(code, detail)) + ")");
                return;
            }

            BufferedReader reader = new BufferedReader(
                    new InputStreamReader(conn.getInputStream(), "UTF-8"));
            String line;
            while ((line = reader.readLine()) != null) {
                if (cancelled.get()) break;
                if (!line.startsWith("data:")) continue;
                String data = line.substring(5).trim();
                if (data.length() == 0 || "[DONE]".equals(data)) continue;
                String delta = extractDelta(data);
                if (delta != null && delta.length() > 0) {
                    emit("QiaoqiaoNative.delta(" + q(id) + "," + q(delta) + ")");
                }
            }
            reader.close();
            if (!cancelled.get()) {
                emit("QiaoqiaoNative.done(" + q(id) + ")");
            }
        } catch (Exception e) {
            if (!cancelled.get()) {
                emit("QiaoqiaoNative.error(" + q(id) + "," + q(readable(e)) + ")");
            }
        } finally {
            cancels.remove(id);
            if (conn != null) conn.disconnect();
        }
    }

    /** 把整个 delta 对象以 JSON 字符串回传，前端自己取 content / tool_calls */
    private String extractDelta(String data) {
        try {
            JSONObject obj = new JSONObject(data);
            JSONArray choices = obj.optJSONArray("choices");
            if (choices == null || choices.length() == 0) return null;
            JSONObject first = choices.getJSONObject(0);
            JSONObject delta = first.optJSONObject("delta");
            if (delta == null) return null;
            return delta.toString();
        } catch (Exception e) {
            return null;
        }
    }

    private String friendly(int code, String body) {
        if (code == 401 || code == 403) {
            return "接口拒绝了这次请求（" + code + "），多半是 API Key 不对或者没余额。";
        }
        String msg = "";
        try {
            JSONObject obj = new JSONObject(body == null ? "{}" : body);
            Object err = obj.opt("error");
            if (err instanceof JSONObject) {
                msg = ((JSONObject) err).optString("message", "");
            } else if (err != null) {
                msg = String.valueOf(err);
            }
        } catch (Exception ignored) {
            msg = body == null ? "" : body;
        }
        if (msg.length() > 200) msg = msg.substring(0, 200);
        return "接口返回 " + code + "：" + msg;
    }

    private String readable(Exception e) {
        String s = e.toString();
        if (s.contains("UnknownHost")) return "连不上服务器，检查一下网络";
        if (s.contains("SocketTimeout")) return "请求超时了，再试一次";
        if (s.contains("SSL")) return "HTTPS 握手失败：" + s;
        return s;
    }

    private String readAll(InputStream in) {
        if (in == null) return "";
        try {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return new String(bos.toByteArray(), "UTF-8");
        } catch (Exception e) {
            return "";
        }
    }

    /* ---------------- 普通 JSON POST（搜索 / 抓取） ---------------- */

    @JavascriptInterface
    public void post(final String id, final String url, final String key, final String body) {
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection conn = null;
                try {
                    conn = (HttpURLConnection) new URL(url).openConnection();
                    conn.setRequestMethod("POST");
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(30000);
                    conn.setDoOutput(true);
                    conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                    conn.setRequestProperty("Authorization", "Bearer " + key);
                    byte[] payload = body.getBytes("UTF-8");
                    conn.setFixedLengthStreamingMode(payload.length);
                    OutputStream os = conn.getOutputStream();
                    os.write(payload);
                    os.flush();
                    os.close();

                    int code = conn.getResponseCode();
                    String text = code >= 400 ? readAll(conn.getErrorStream()) : readAll(conn.getInputStream());
                    if (code >= 400) {
                        emit("QingliaoNative.postFail(" + q(id) + "," + q("HTTP " + code + " " + text) + ")");
                    } else {
                        emit("QingliaoNative.postDone(" + q(id) + "," + q(text) + ")");
                    }
                } catch (Exception e) {
                    emit("QingliaoNative.postFail(" + q(id) + "," + q(readable(e)) + ")");
                } finally {
                    if (conn != null) conn.disconnect();
                }
            }
        });
        t.setDaemon(true);
        t.start();
    }

    /* ---------------- 其它 ---------------- */

    @JavascriptInterface
    public void copy(String text) {
        try {
            ClipboardManager cm = (ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("qingliao", text));
        } catch (Exception ignored) {
        }
    }

    @JavascriptInterface
    public void ping(final String id, final String url, final String key) {
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection conn = null;
                try {
                    conn = (HttpURLConnection) new URL(url).openConnection();
                    conn.setRequestMethod("GET");
                    conn.setRequestProperty("Authorization", "Bearer " + key);
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(15000);
                    int code = conn.getResponseCode();
                    boolean ok = code < 400;
                    emit("QiaoqiaoNative.pong(" + q(id) + "," + ok + "," +
                            q(ok ? "ok" : ("HTTP " + code)) + ")");
                } catch (Exception e) {
                    emit("QiaoqiaoNative.pong(" + q(id) + ",false," + q(readable(e)) + ")");
                } finally {
                    if (conn != null) conn.disconnect();
                }
            }
        });
        t.setDaemon(true);
        t.start();
    }

    @JavascriptInterface
    public void setBars(final boolean dark) {
        main.post(new Runnable() {
            @Override
            public void run() {
                try {
                    Activity a = (Activity) ctx;
                    if (a == null) return;
                    int color = Color.parseColor(dark ? "#17181b" : "#f7f8fa");
                    a.getWindow().setStatusBarColor(color);
                    a.getWindow().setNavigationBarColor(color);
                    View decor = a.getWindow().getDecorView();
                    int flags = decor.getSystemUiVisibility();
                    if (dark) {
                        flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                    } else {
                        flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                    }
                    if (Build.VERSION.SDK_INT >= 26) {
                        if (dark) {
                            flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                        } else {
                            flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                        }
                    }
                    decor.setSystemUiVisibility(flags);
                } catch (Exception ignored) {
                }
            }
        });
    }

    /* ---------------- 工具 ---------------- */

    private void emit(final String js) {
        main.post(new Runnable() {
            @Override
            public void run() {
                try {
                    if (web != null) web.evaluateJavascript(js, null);
                } catch (Exception ignored) {
                }
            }
        });
    }

    private String q(String s) {
        return JSONObject.quote(s == null ? "" : s);
    }
}
