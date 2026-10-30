package io.github.ivanminguez.cinder;

import android.os.Bundle;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(CinderNativePlugin.class); // modo claro de las barras y widget de la peli de la semana
        super.onCreate(savedInstanceState);
        WebSettings settings = getBridge().getWebView().getSettings();
        // La letra grande del sistema no agranda la web: Cinder ya está pensada para leerse bien en el móvil
        // y con el texto al 130-200 % se salían botones y cartas de la pantalla
        settings.setTextZoom(100);
        // Sin zoom con dos dedos (la app se usa deslizando las cartas)
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        // La web nunca se mete debajo de la barra de estado, la muesca ni la barra de navegación:
        // se le deja el hueco desde Android, igual en todos los móviles y versiones del WebView
        // (antes dependía de env() o de las variables de SystemBars y en algunos móviles no llegaban)
        // (el hueco va en el contenedor del WebView: el padding del propio WebView no se respeta al hacer scroll)
        WebView webView = getBridge().getWebView();
        View box = (View) webView.getParent();
        box.setBackgroundColor(0xFF14100F);
        ViewCompat.setOnApplyWindowInsetsListener(box, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(box);
    }
}
