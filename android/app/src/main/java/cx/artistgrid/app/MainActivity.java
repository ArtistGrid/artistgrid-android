package cx.artistgrid.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Serves /_proxy?u=… so covers and audio can be fetched natively (see ProxyWebViewClient).
        bridge.setWebViewClient(new ProxyWebViewClient(bridge));
    }
}
