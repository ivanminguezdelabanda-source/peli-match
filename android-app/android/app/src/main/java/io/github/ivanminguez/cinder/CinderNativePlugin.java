package io.github.ivanminguez.cinder;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.view.View;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Lo que la web de Cinder le pide a Android:
 * - setBars: color del hueco de la barra de estado y de navegación (modo claro u oscuro) y color de sus iconos.
 * - setWidget: guarda la peli de la semana para el widget de la pantalla de inicio y lo actualiza.
 * - setBox: las pelis que sortea el widget de la Caja.
 * - refreshNews: pide noticias nuevas para el widget de noticias.
 */
@CapacitorPlugin(name = "CinderNative")
public class CinderNativePlugin extends Plugin {

    static final String PREFS = "cinder_widget";
    static final String POSTER = "widget_poster.jpg";

    @PluginMethod
    public void setBars(PluginCall call) {
        String color = call.getString("color", "#14100f");
        boolean light = Boolean.TRUE.equals(call.getBoolean("light", false));
        getActivity().runOnUiThread(() -> {
            try {
                View box = (View) getBridge().getWebView().getParent();
                box.setBackgroundColor(Color.parseColor(color));
                WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getActivity().getWindow(), getActivity().getWindow().getDecorView());
                c.setAppearanceLightStatusBars(light);
                c.setAppearanceLightNavigationBars(light);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    @PluginMethod
    public void setWidget(PluginCall call) {
        Context ctx = getContext();
        String id = call.getString("id", "");
        String poster = call.getString("poster", "");
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        boolean samePoster = poster.equals(prefs.getString("posterUrl", "")) && new File(ctx.getFilesDir(), POSTER).exists();
        prefs.edit()
            .putString("id", id)
            .putString("title", call.getString("title", ""))
            .putString("meta", call.getString("meta", ""))
            .putString("reason", call.getString("reason", ""))
            .putString("label", call.getString("label", "Peli de la semana"))
            .apply();
        WeeklyWidget.updateAll(ctx);
        if (samePoster || poster.isEmpty()) { call.resolve(); return; }
        // El cartel se descarga una vez y se guarda en la app: el widget no puede cargar imágenes de internet
        new Thread(() -> {
            if (download(poster, new File(ctx.getFilesDir(), POSTER))) {
                prefs.edit().putString("posterUrl", poster).apply();
                WeeklyWidget.updateAll(ctx);
            }
            call.resolve(); // sin cartel, el widget enseña solo el texto
        }).start();
    }

    /** Pelis para el widget de la Caja: [{ id, title, meta, poster }] (las que la app sortearía). */
    @PluginMethod
    public void setBox(PluginCall call) {
        Context ctx = getContext();
        try {
            BoxWidget.saveItems(ctx, call.getArray("items").toString());
        } catch (Exception e) {
            call.reject(e.getMessage());
            return;
        }
        new Thread(() -> BoxWidget.ensurePick(ctx)).start();
        call.resolve();
    }

    /** Vuelve a descargar las noticias del widget de noticias (al abrir la app). */
    @PluginMethod
    public void refreshNews(PluginCall call) {
        NewsWidget.refresh(getContext(), null);
        call.resolve();
    }

    /** Descarga url en dest (pasando por un temporal); false si falla. */
    static boolean download(String url, File dest) {
        try {
            HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
            con.setConnectTimeout(10000);
            con.setReadTimeout(20000);
            File tmp = new File(dest.getPath() + ".tmp");
            try (InputStream in = con.getInputStream(); FileOutputStream out = new FileOutputStream(tmp)) {
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            return tmp.renameTo(dest);
        } catch (Exception e) {
            return false;
        }
    }
}
