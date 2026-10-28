package io.github.ivanminguez.cinder;

import android.os.Bundle;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebSettings settings = getBridge().getWebView().getSettings();
        // La letra grande del sistema no agranda la web: Cinder ya está pensada para leerse bien en el móvil
        // y con el texto al 130-200 % se salían botones y cartas de la pantalla
        settings.setTextZoom(100);
        // Sin zoom con dos dedos (la app se usa deslizando las cartas)
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
    }
}
