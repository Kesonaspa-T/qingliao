package com.qingliao.app;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.webkit.JavascriptInterface;

/**
 * 系统通知：她发来消息 / 照片 / 朋友圈的时候，在通知栏弹一条。
 *
 * WebView 里没有 Web Notification（`new Notification(...)` 在 App 里是无效的），
 * macOS 壳走的是原生 WKWebView 桥，Android 这边只能自己写一个。
 *
 * 规则跟微信一致：
 *   - App 在前台时不弹（用户正看着呢），由 MainActivity 的 onResume/onPause 维护；
 *   - 点通知会打开 App 并直接进那个聊天。
 */
public class NotifyBridge {
    private static final String CHANNEL_ID = "qingliao-msg";
    private static final int REQ_NOTIFY = 1002;

    private final Activity act;
    private final NotificationManager nm;

    /** 由 MainActivity 的 onResume/onPause 维护：App 是不是在前台。 */
    private static boolean foreground = false;
    private static int seq = 0;

    public NotifyBridge(Activity a) {
        this.act = a;
        this.nm = (NotificationManager) a.getSystemService(Context.NOTIFICATION_SERVICE);
        ensureChannel();
    }

    public static void setForeground(boolean f) { foreground = f; }

    public static int permissionRequestCode() { return REQ_NOTIFY; }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < 26 || nm == null) return;
        try {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "消息", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("她发来的消息、照片、朋友圈");
            ch.enableVibration(true);
            nm.createNotificationChannel(ch);
        } catch (Exception ignored) {
        }
    }

    /** 网页问：App 在前台吗？前台就不弹通知。 */
    @JavascriptInterface
    public boolean foreground() { return foreground; }

    /** 有没有通知权限（Android 13 起要用户点同意）。 */
    @JavascriptInterface
    public boolean allowed() {
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                return act.checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                        == PackageManager.PERMISSION_GRANTED;
            }
            return nm != null && nm.areNotificationsEnabled();
        } catch (Exception e) {
            return false;
        }
    }

    /** 申请通知权限（Android 13+ 才会弹系统框；别的版本直接忽略）。 */
    @JavascriptInterface
    public void requestPermission() {
        if (Build.VERSION.SDK_INT < 33) return;
        try {
            act.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (allowed()) return;
                    try {
                        act.requestPermissions(
                                new String[]{"android.permission.POST_NOTIFICATIONS"}, REQ_NOTIFY);
                    } catch (Exception ignored) {
                    }
                }
            });
        } catch (Exception ignored) {
        }
    }

    /**
     * 弹一条通知。kind / conv 用来在点开之后直接进那个聊天。
     * 返回有没有真的弹出去（没权限 / 被关掉时返回 false，网页就不用再等）。
     */
    @JavascriptInterface
    public boolean show(String title, String body, String kind, String conv) {
        try {
            if (nm == null || !allowed()) return false;
            String t = (title == null || title.isEmpty()) ? "轻聊" : title;
            String b = (body == null || body.isEmpty()) ? "她发了条消息" : body;

            Intent i = new Intent(act, MainActivity.class);
            i.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            i.putExtra("ql_kind", kind == null ? "" : kind);
            i.putExtra("ql_conv", conv == null ? "" : conv);

            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
            seq = (seq + 1) & 0xffff;
            PendingIntent pi = PendingIntent.getActivity(act, seq, i, flags);

            Notification.Builder builder = (Build.VERSION.SDK_INT >= 26)
                    ? new Notification.Builder(act, CHANNEL_ID)
                    : new Notification.Builder(act);
            builder.setContentTitle(t)
                    .setContentText(b)
                    .setSmallIcon(R.mipmap.ic_launcher)
                    .setAutoCancel(true)
                    .setContentIntent(pi)
                    .setStyle(new Notification.BigTextStyle().bigText(b));
            if (Build.VERSION.SDK_INT < 26) {
                builder.setPriority(Notification.PRIORITY_HIGH);
            }
            nm.notify("ql-" + (conv == null ? "msg" : conv) + "-" + seq, 1, builder.build());
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
