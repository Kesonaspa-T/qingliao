package com.qingliao.app;

import android.content.ContentValues;
import android.content.Context;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * 把网页里的图片 / 文件存进手机的「下载」目录。
 *
 * WebView 里点 &lt;a download&gt; 是没有任何反应的（没有下载管理器接这个事件），
 * 所以网页上「保存图片」必须交给原生来写：
 *   - Android 10+ 走 MediaStore，不需要任何权限，用户在「文件 / 下载」里就能看到；
 *   - 更老的系统写外置目录的 App 私有文件夹（同样不需要权限），路径会回给网页提示。
 *
 * 只做「把一段 base64 写成文件」这一件事，不联网、不读别的数据。
 */
public class SaveBridge {
    private final Context ctx;

    public SaveBridge(Context c) { this.ctx = c; }

    private static String safeName(String name, String mime) {
        String n = name == null ? "" : name.trim();
        if (n.isEmpty()) n = "qingliao";
        n = n.replace('/', '_').replace('\\', '_').replace(':', '_');
        if (n.indexOf('.') < 0) {
            String ext = "jpg";
            if (mime != null && mime.indexOf("png") >= 0) ext = "png";
            else if (mime != null && mime.indexOf("webp") >= 0) ext = "webp";
            else if (mime != null && mime.indexOf("gif") >= 0) ext = "gif";
            else if (mime != null && mime.indexOf("zip") >= 0) ext = "zip";
            else if (mime != null && mime.indexOf("json") >= 0) ext = "json";
            else if (mime != null && mime.indexOf("text") >= 0) ext = "txt";
            n = n + "." + ext;
        }
        return n;
    }

    /** 返回存到哪儿（给网页提示用）；失败返回空串。 */
    @JavascriptInterface
    public String save(String name, String base64) {
        if (base64 == null || base64.isEmpty()) return "";
        String mime = "image/jpeg";
        try {
            String data = base64;
            if (data.startsWith("data:")) {
                int semi = data.indexOf(';');
                if (semi > 5 && semi < 80) mime = data.substring(5, semi);
                int comma = data.indexOf(',');
                if (comma > 0) data = data.substring(comma + 1);
            }
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            String fileName = safeName(name, mime);

            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
                v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                Uri uri = ctx.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) return "";
                OutputStream out = ctx.getContentResolver().openOutputStream(uri);
                if (out == null) return "";
                try {
                    out.write(bytes);
                    out.flush();
                } finally {
                    out.close();
                }
                ContentValues done = new ContentValues();
                done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                ctx.getContentResolver().update(uri, done, null, null);
                return Environment.DIRECTORY_DOWNLOADS + "/" + fileName;
            }

            File dir = ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (dir == null) dir = ctx.getFilesDir();
            if (!dir.exists() && !dir.mkdirs()) return "";
            File f = new File(dir, fileName);
            FileOutputStream out = new FileOutputStream(f);
            try {
                out.write(bytes);
                out.flush();
            } finally {
                out.close();
            }
            MediaScannerConnection.scanFile(ctx, new String[]{f.getAbsolutePath()},
                    new String[]{mime}, null);
            return f.getAbsolutePath();
        } catch (Exception e) {
            return "";
        }
    }
}
