package io.github.ivanminguez.cinder;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Widget de Novedades: las pelis destacadas pasando solas (como el carrusel de la app) y los dos últimos
 * titulares de cine (Espinof, Fotogramas…). Se actualiza solo cada pocas horas y cada vez que se abre la app.
 * Tocar una destacada abre su ficha; tocar un titular abre la noticia.
 */
public class NewsWidget extends AppWidgetProvider {

    static final String PREFS = "cinder_news";
    static final String URL_NEWS = "https://ivanminguezdelabanda-source.github.io/peli-match/data/news.json";
    static final int[][] ROWS = {
        { R.id.news_row1, R.id.news_title1, R.id.news_src1 },
        { R.id.news_row2, R.id.news_title2, R.id.news_src2 },
    };
    static final int MAX_SLIDES = 5;

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
                JSONObject data = new JSONObject(buf.toString("UTF-8"));
                saveSlides(ctx, data);
                JSONArray news = data.optJSONArray("news");
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

    /** Destacada + tendencias (las mismas que el carrusel de la app), con su fondo descargado y reducido. */
    static void saveSlides(Context ctx, JSONObject data) throws Exception {
        JSONArray movies = data.optJSONArray("movies");
        if (movies == null) return;
        Map<String, JSONObject> byId = new HashMap<>();
        for (int i = 0; i < movies.length(); i++) byId.put(movies.getJSONObject(i).optString("id"), movies.getJSONObject(i));
        List<String> ids = new ArrayList<>();
        ids.add(data.optString("featured"));
        JSONArray trending = data.optJSONArray("trending");
        for (int i = 0; trending != null && i < trending.length(); i++) if (!ids.contains(trending.optString(i))) ids.add(trending.optString(i));
        JSONArray keep = new JSONArray();
        for (String id : ids) {
            if (keep.length() >= MAX_SLIDES) break;
            JSONObject m = byId.get(id);
            String img = m == null ? "" : m.optString("backdrop", m.optString("poster", ""));
            if (img.isEmpty() || img.equals("null")) continue;
            int n = keep.length();
            File f = new File(ctx.getFilesDir(), "news_slide" + n + ".jpg");
            if (!CinderNativePlugin.download(img.replace("/w780/", "/w300/").replace("/w500/", "/w342/"), f)) continue;
            JSONArray genres = m.optJSONArray("genres");
            String meta = m.optString("year");
            if (genres != null && genres.length() > 0) meta += " · " + genres.optString(0);
            if (!m.isNull("rating")) meta += String.format(Locale.ROOT, " · %.1f/10", m.optDouble("rating"));
            keep.put(new JSONObject().put("id", id).put("title", m.optString("title")).put("meta", meta)
                .put("kicker", n == 0 ? "DESTACADA DE LA SEMANA" : "EN TENDENCIA"));
        }
        if (keep.length() > 0) ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("slides", keep.toString()).apply();
    }

    /** Fondo de una destacada, a lo sumo 360 px de ancho y en 16 bits: el widget tiene poca memoria para imágenes. */
    static Bitmap slideBitmap(File f) {
        if (!f.exists()) return null;
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inPreferredConfig = Bitmap.Config.RGB_565;
        Bitmap b = BitmapFactory.decodeFile(f.getPath(), o);
        if (b == null || b.getWidth() <= 360) return b;
        Bitmap s = Bitmap.createScaledBitmap(b, 360, Math.round(b.getHeight() * 360f / b.getWidth()), true);
        b.recycle();
        return s;
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
        JSONArray slides;
        try { slides = new JSONArray(p.getString("slides", "[]")); } catch (Exception e) { slides = new JSONArray(); }
        v.setViewVisibility(R.id.news_empty, news.length() == 0 && slides.length() == 0 ? View.VISIBLE : View.GONE);
        v.setViewVisibility(R.id.news_flipper, slides.length() == 0 ? View.GONE : View.VISIBLE);
        v.removeAllViews(R.id.news_flipper);
        for (int i = 0; i < slides.length(); i++) {
            JSONObject m = slides.optJSONObject(i);
            RemoteViews slide = new RemoteViews(ctx.getPackageName(), R.layout.widget_news_slide);
            Bitmap img = slideBitmap(new File(ctx.getFilesDir(), "news_slide" + i + ".jpg"));
            if (img != null) slide.setImageViewBitmap(R.id.slide_img, img);
            slide.setTextViewText(R.id.slide_kicker, m.optString("kicker"));
            slide.setTextViewText(R.id.slide_title, m.optString("title"));
            slide.setTextViewText(R.id.slide_meta, m.optString("meta"));
            Intent film = new Intent(Intent.ACTION_VIEW, Uri.parse("io.github.ivanminguez.cinder://peli/" + m.optString("id")), ctx, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            slide.setOnClickPendingIntent(R.id.slide_root, PendingIntent.getActivity(ctx, 30 + i, film, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            v.addView(R.id.news_flipper, slide);
        }
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
