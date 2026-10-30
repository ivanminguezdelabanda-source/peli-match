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
import java.io.File;

/** Widget de la pantalla de inicio: la peli de la semana de Cinder. Tocarlo abre su ficha en la app. */
public class WeeklyWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context ctx, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, views(ctx));
    }

    static void updateAll(Context ctx) {
        AppWidgetManager manager = AppWidgetManager.getInstance(ctx);
        int[] ids = manager.getAppWidgetIds(new ComponentName(ctx, WeeklyWidget.class));
        if (ids.length > 0) manager.updateAppWidget(ids, views(ctx));
    }

    static RemoteViews views(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(CinderNativePlugin.PREFS, Context.MODE_PRIVATE);
        String movie = p.getString("id", "");
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_weekly);
        if (movie.isEmpty()) {
            v.setTextViewText(R.id.widget_title, "Abre Cinder");
            v.setTextViewText(R.id.widget_meta, "y te elegimos tu peli de la semana");
            v.setViewVisibility(R.id.widget_reason, View.GONE);
            v.setViewVisibility(R.id.widget_poster, View.GONE);
        } else {
            v.setTextViewText(R.id.widget_label, p.getString("label", "Peli de la semana"));
            v.setTextViewText(R.id.widget_title, p.getString("title", ""));
            v.setTextViewText(R.id.widget_meta, p.getString("meta", ""));
            String reason = p.getString("reason", "");
            v.setTextViewText(R.id.widget_reason, reason);
            v.setViewVisibility(R.id.widget_reason, reason.isEmpty() ? View.GONE : View.VISIBLE);
            Bitmap poster = loadPoster(ctx);
            if (poster != null) {
                v.setImageViewBitmap(R.id.widget_poster, poster);
                v.setViewVisibility(R.id.widget_poster, View.VISIBLE);
            } else {
                v.setViewVisibility(R.id.widget_poster, View.GONE);
            }
        }
        // Al tocarlo se abre la ficha (o la app, si aún no hay peli)
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse("io.github.ivanminguez.cinder://peli/" + movie), ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 7, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        v.setOnClickPendingIntent(R.id.widget_root, pi);
        return v;
    }

    // Cartel reducido (los widgets no aceptan imágenes muy grandes)
    private static Bitmap loadPoster(Context ctx) {
        File f = new File(ctx.getFilesDir(), CinderNativePlugin.POSTER);
        if (!f.exists()) return null;
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inSampleSize = 2;
        Bitmap b = BitmapFactory.decodeFile(f.getAbsolutePath(), o);
        if (b == null) return null;
        int w = 240, h = Math.round(240f * b.getHeight() / b.getWidth());
        return Bitmap.createScaledBitmap(b, w, h, true);
    }
}
