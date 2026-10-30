package io.github.ivanminguez.cinder;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;
import java.io.File;
import java.util.Random;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Widget de la Caja: sortea una peli entre las que la app le pasa (tus matches por ver o, si tienes pocos,
 * una selección para ti). «Girar» elige otra sin abrir la app; tocar la peli abre su ficha.
 */
public class BoxWidget extends AppWidgetProvider {

    static final String PREFS = "cinder_box";
    static final String POSTER = "box_poster.jpg";
    static final String SPIN = "io.github.ivanminguez.cinder.BOX_SPIN";

    static void saveItems(Context ctx, String json) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("items", json).apply();
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, views(ctx, false));
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        super.onReceive(ctx, intent);
        if (!SPIN.equals(intent.getAction())) return;
        // Se ve «Girando…» al momento y la peli nueva cuando llega su cartel
        updateAll(ctx, true);
        PendingResult async = goAsync();
        new Thread(() -> {
            try { spin(ctx); } finally { async.finish(); }
        }).start();
    }

    /** Si no hay peli elegida (o ya no está entre las de la caja), sortea una. */
    static void ensurePick(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONArray items = items(p);
        String cur = p.getString("cur", "");
        for (int i = 0; i < items.length(); i++) if (cur.equals(items.optJSONObject(i).optString("id"))) { updateAll(ctx, false); return; }
        spin(ctx);
    }

    static void spin(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONArray items = items(p);
        if (items.length() == 0) { p.edit().remove("cur").apply(); updateAll(ctx, false); return; }
        String cur = p.getString("cur", "");
        Random r = new Random();
        JSONObject pick = items.optJSONObject(r.nextInt(items.length()));
        for (int k = 0; k < 4 && items.length() > 1 && cur.equals(pick.optString("id")); k++) pick = items.optJSONObject(r.nextInt(items.length()));
        String poster = pick.optString("poster", "");
        File f = new File(ctx.getFilesDir(), POSTER);
        boolean ok = !poster.isEmpty() && CinderNativePlugin.download(poster, f);
        if (!ok) f.delete();
        p.edit().putString("cur", pick.optString("id")).putString("pick", pick.toString()).apply();
        updateAll(ctx, false);
    }

    static JSONArray items(SharedPreferences p) {
        try { return new JSONArray(p.getString("items", "[]")); } catch (Exception e) { return new JSONArray(); }
    }

    static void updateAll(Context ctx, boolean spinning) {
        AppWidgetManager manager = AppWidgetManager.getInstance(ctx);
        int[] ids = manager.getAppWidgetIds(new ComponentName(ctx, BoxWidget.class));
        if (ids.length > 0) manager.updateAppWidget(ids, views(ctx, spinning));
    }

    static RemoteViews views(Context ctx, boolean spinning) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_box);
        JSONObject pick = null;
        try { pick = new JSONObject(p.getString("pick", "")); } catch (Exception e) { /* sin peli */ }
        String id = pick != null ? pick.optString("id") : "";
        if (spinning) {
            v.setTextViewText(R.id.box_title, "Girando…");
            v.setTextViewText(R.id.box_meta, "🎲 🎲 🎲");
        } else if (pick == null || items(p).length() == 0) {
            v.setTextViewText(R.id.box_title, "Abre Cinder");
            v.setTextViewText(R.id.box_meta, "y guarda pelis para sortearlas aquí");
        } else {
            v.setTextViewText(R.id.box_title, pick.optString("title"));
            v.setTextViewText(R.id.box_meta, pick.optString("meta"));
        }
        Bitmap poster = spinning ? null : WeeklyWidget.loadPoster(new File(ctx.getFilesDir(), POSTER));
        if (poster != null) {
            v.setImageViewBitmap(R.id.box_poster, poster);
            v.setViewVisibility(R.id.box_poster, View.VISIBLE);
        } else {
            v.setViewVisibility(R.id.box_poster, View.GONE);
        }
        // «Girar»: sortea otra aquí mismo, sin abrir la app
        Intent spin = new Intent(ctx, BoxWidget.class).setAction(SPIN);
        v.setOnClickPendingIntent(R.id.box_spin, PendingIntent.getBroadcast(ctx, 11, spin, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        // Tocar la peli abre su ficha; sin peli, abre la Caja de la app
        Uri uri = Uri.parse(id.isEmpty() ? "io.github.ivanminguez.cinder://caja" : "io.github.ivanminguez.cinder://peli/" + id);
        Intent open = new Intent(Intent.ACTION_VIEW, uri, ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        v.setOnClickPendingIntent(R.id.box_pick, PendingIntent.getActivity(ctx, 12, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        return v;
    }
}
