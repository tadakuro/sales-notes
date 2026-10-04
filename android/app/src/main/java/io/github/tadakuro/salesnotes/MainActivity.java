package io.github.tadakuro.salesnotes;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.util.Base64;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;

/**
 * Thin offline wrapper around the static site in
 * {@code assets/www} (copied from {@code site/} at build time).
 *
 * <p>Zero external dependencies — framework WebView only.
 */
public class MainActivity extends Activity {

    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final String ENTRY_PAGE = "file:///android_asset/www/index.html";

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        // The page runs from file:// but talks to the https:// Worker (sync + Telegram).
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setJavaScriptCanOpenWindowsAutomatically(true);

        webView.addJavascriptInterface(new BlobBridge(), "AndroidBlob");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
                    // Keep navigation inside the app for http(s) links.
                    view.loadUrl(url);
                    return true;
                }
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                view.evaluateJavascript(BLOB_HOOK_JS, null);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            // <input type="file"> (JSON import). No camera needed.
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES,
                        new String[]{"application/json", "text/plain"});
                try {
                    startActivityForResult(
                            Intent.createChooser(intent, "Pilih file backup"),
                            FILE_CHOOSER_REQUEST);
                } catch (ActivityNotFoundException e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });

        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent,
                                        String contentDisposition, String mimeType,
                                        long contentLength) {
                if (url != null && url.startsWith("blob:")) {
                    // Handled by the injected BLOB_HOOK_JS bridge instead.
                    return;
                }
                try {
                    DownloadManager.Request req =
                            new DownloadManager.Request(Uri.parse(url));
                    req.setMimeType(mimeType);
                    req.addRequestHeader("User-Agent", userAgent);
                    req.setNotificationVisibility(
                            DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    String name = android.webkit.URLUtil.guessFileName(
                            url, contentDisposition, mimeType);
                    req.setDestinationInExternalPublicDir(
                            Environment.DIRECTORY_DOWNLOADS, name);
                    DownloadManager dm =
                            (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    if (dm != null) {
                        dm.enqueue(req);
                        toast("Mengunduh " + name);
                    }
                } catch (Exception e) {
                    toast("Gagal mengunduh");
                }
            }
        });

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(ENTRY_PAGE);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (filePathCallback == null) return;
            Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private void toast(final String msg) {
        runOnUiThread(() ->
                Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show());
    }

    /**
     * Receives blob: downloads (Export JSON / Excel .xls use
     * {@code URL.createObjectURL}) as base64 and saves them to Downloads.
     * Injected page-side hook lives in {@link #BLOB_HOOK_JS}.
     */
    private class BlobBridge {
        @JavascriptInterface
        public void save(final String dataUrl, final String filename,
                         final String mimeType) {
            new Thread(() -> {
                try {
                    String base64 = dataUrl;
                    int comma = dataUrl.indexOf(',');
                    if (comma >= 0) base64 = dataUrl.substring(comma + 1);
                    byte[] bytes = Base64.decode(base64, Base64.DEFAULT);

                    String safe = (filename == null || filename.isEmpty())
                            ? "sales-notes-export.bin" : filename;
                    File dir = Environment.getExternalStoragePublicDirectory(
                            Environment.DIRECTORY_DOWNLOADS);
                    boolean toPublic = dir != null && (dir.exists() || dir.mkdirs());
                    File out = toPublic
                            ? new File(dir, safe)
                            : new File(getExternalFilesDir(null), safe);
                    // Avoid overwriting an existing export.
                    int n = 1;
                    while (out.exists()) {
                        int dot = safe.lastIndexOf('.');
                        String stem = dot > 0 ? safe.substring(0, dot) : safe;
                        String ext = dot > 0 ? safe.substring(dot) : "";
                        out = new File(out.getParent(), stem + "-" + (n++) + ext);
                    }
                    try (FileOutputStream fos = new FileOutputStream(out)) {
                        fos.write(bytes);
                    }
                    if (!toPublic && Build.VERSION.SDK_INT >= 29) {
                        // Visible in Files via app storage; still notify the user.
                    }
                    toast("Tersimpan: " + out.getName());
                } catch (Exception e) {
                    toast("Gagal menyimpan file");
                }
            }).start();
        }
    }

    /**
     * Intercepts anchor clicks that point at blob: URLs (the site's export
     * buttons), converts the blob to base64 and hands it to
     * {@code AndroidBlob.save}. Everything else is left untouched, and any
     * failure falls back to the default click behaviour.
     */
    private static final String BLOB_HOOK_JS =
            "(function(){"
            + "if(window.__snBlobHook)return;window.__snBlobHook=true;"
            + "document.addEventListener('click',function(ev){"
            + "try{"
            + "var a=ev.target&&ev.target.closest?ev.target.closest('a'):null;"
            + "if(!a||!a.href||a.href.indexOf('blob:')!==0)return;"
            + "if(typeof AndroidBlob==='undefined')return;"
            + "ev.preventDefault();ev.stopPropagation();"
            + "var name=a.getAttribute('download')||'sales-notes-export.bin';"
            + "fetch(a.href).then(function(r){return r.blob();}).then(function(b){"
            + "var fr=new FileReader();"
            + "fr.onload=function(){try{AndroidBlob.save(fr.result,name,b.type||'application/octet-stream');}catch(e){};};"
            + "fr.onerror=function(){try{a.click();}catch(e){}};"
            + "fr.readAsDataURL(b);"
            + "}).catch(function(){try{window.open(a.href,'_blank');}catch(e){}});"
            + "}catch(e){}"
            + "},true);"
            + "})();";
}
