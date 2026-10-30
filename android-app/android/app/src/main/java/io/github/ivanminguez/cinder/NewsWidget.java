package io.github.ivanminguez.cinder;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Widget de noticias de cine: los tres últimos titulares de Novedades (Espinof, Fotogramas…).
 * Se actualiza solo cada pocas horas y cada vez que se abre la app. Tocar un titular abre la noticia.
 */
public class NewsWidget extends AppWidgetProvider {

    static final String PREFS = "cinder_news";
    static final String URL_NEWS = "https://ivanminguezdelabanda-source.github.io/peli-match/data/news.json";
    static final int[][] ROWS = {
        { R.id.news_row1, R.id.news_title1, R.id.news_src1 },
        { R.id.news_row2, R.id.news_title2, R.id.news_src2 },
        { R.id.news_row3, R.id.news_title3, R.id.news_src3 },
    };

    @Override
    public void onUpdate(Context ctx, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, views(ctx));
        PendingResult async = goAsync();
        refresh(ctx, async::finish);
    }

    /** Descarga news.json (unos 150 KB), guarda los titulares y repinta. */
    static void refresh(Context ctx, Runnable done) {
        new Thread(() -> {
            try {
                HttpURLConnection con = (HttpURLConnection) new URL(URL_NEWS + "?t=" + System.currentTimeMillis()).openConnection();
                con.setConnectTimeout(10000);
                con.setReadTimeout(20000);
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                try (InputStream in = con.getInputStream()) {
                    byte[] b = new byte[16384];
                    int n;
                    while ((n = in.read(b)) > 0) buf.write(b, 0, n);
                }
                JSONArray news = new JSONObject(buf.toString("UTF-8")).optJSONArray("news");
                JSONArray keep = new JSONArray();
                for (int i = 0; news != null && i < news.length() && keep.length() < ROWS.length; i++) {
                    JSONObject n = news.optJSONObject(i);
                    if (n == null || n.optString("title").isEmpty()) continue;
                    keep.put(new JSONObject().put("title", n.optString("title")).put("source", n.optString("source")).put("link", n.optString("link")));
                }
                if (keep.length() > 0) ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("news", keep.toString()).apply();
                updateAll(ctx);
            } catch (Exception e) {
                // sin conexión: se quedan los titulares de la última vez
            } finally {
                if (done != null) done.run();
            }
        }).start();
    }

    static void updateAll(Context ctx) {
        AppWidgetManager manager = AppWidgetManager.getInstance(ctx);
        int[] ids = manager.getAppWidgetIds(new ComponentName(ctx, NewsWidget.class));
        if (ids.length > 0) manager.updateAppWidget(ids, views(ctx));
    }

    static RemoteViews views(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_news);
        JSONArray news;
        try { news = new JSONArray(p.getString("news", "[]")); } catch (Exception e) { news = new JSONArray(); }
        v.setViewVisibility(R.id.news_empty, news.length() == 0 ? View.VISIBLE : View.GONE);
        for (int i = 0; i < ROWS.length; i++) {
            JSONObject n = news.optJSONObject(i);
            if (n == null) { v.setViewVisibility(ROWS[i][0], View.GONE); continue; }
            v.setViewVisibility(ROWS[i][0], View.VISIBLE);
            v.setTextViewText(ROWS[i][1], n.optString("title"));
            v.setTextViewText(ROWS[i][2], n.optString("source").toUpperCase());
            Intent read = new Intent(Intent.ACTION_VIEW, Uri.parse(n.optString("link"))).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            v.setOnClickPendingIntent(ROWS[i][0], PendingIntent.getActivity(ctx, 20 + i, read, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        }
        // La cabecera abre Novedades en la app
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse("io.github.ivanminguez.cinder://novedades"), ctx, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        v.setOnClickPendingIntent(R.id.news_head, PendingIntent.getActivity(ctx, 19, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        return v;
    }
}
