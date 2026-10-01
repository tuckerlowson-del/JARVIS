package com.jarvis.android;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.widget.*;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    EditText urlInput, tokenInput, commandInput; TextView status, output;
    ExecutorService pool = Executors.newSingleThreadExecutor();
    String baseUrl="", token="";

    @Override public void onCreate(Bundle b) { super.onCreate(b); setContentView(com.jarvis.android.R.layout.activity_main);
        urlInput=findViewById(R.id.urlInput); tokenInput=findViewById(R.id.tokenInput); commandInput=findViewById(R.id.commandInput); status=findViewById(R.id.status); output=findViewById(R.id.output);
        findViewById(R.id.connectButton).setOnClickListener(v -> connect());
        findViewById(R.id.sendButton).setOnClickListener(v -> sendCommand());
        findViewById(R.id.scanButton).setOnClickListener(v -> scan());
        findViewById(R.id.accessibilityButton).setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        if (android.os.Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},42);
    }

    String normalize(String s){ s=s.trim(); while(s.endsWith("/")) s=s.substring(0,s.length()-1); if(!s.matches("(?i)^https?://.*")) s="http://"+s; return s; }
    void connect(){ baseUrl=normalize(urlInput.getText().toString()); token=tokenInput.getText().toString().trim().toUpperCase(); if(token.length()!=5){status.setText("Pairing code must be exactly 5 letters.");return;} status.setText("Connecting…"); pool.execute(()->{try{JSONObject j=get("/api/info"); post("/api/android/pair", new JSONObject().put("name","JARVIS Android").put("model",android.os.Build.MODEL)); runOnUiThread(()->{status.setText("Connected to JARVIS • "+j.optString("version")); output.setText("PC: "+j.optString("ip")+"\nPairing verified.");});}catch(Exception e){runOnUiThread(()->status.setText("Connection failed: "+e.getMessage()));}}); }
    void sendCommand(){String text=commandInput.getText().toString().trim(); if(text.isEmpty())return; status.setText("Sending…"); pool.execute(()->{try{JSONObject body=new JSONObject().put("text",text); JSONObject r=post("/api/assistant",body); runOnUiThread(()->{status.setText("Connected"); output.setText(r.optString("reply","Done"));});}catch(Exception e){runOnUiThread(()->status.setText("Command failed: "+e.getMessage()));}});}
    void scan(){status.setText("Scanning local network…"); pool.execute(()->{try{JSONObject r=post("/api/network/scan",new JSONObject()); runOnUiThread(()->output.setText("Network: "+r.optString("interface")+"\nLocal IP: "+r.optString("localIp")+"\nDevices found: "+r.optJSONArray("devices")));}catch(Exception e){runOnUiThread(()->status.setText("Scan failed: "+e.getMessage()));}});}
    JSONObject get(String path)throws Exception{return request("GET",path,null);} JSONObject post(String path,JSONObject body)throws Exception{return request("POST",path,body);}
    JSONObject request(String method,String path,JSONObject body)throws Exception{HttpURLConnection c=(HttpURLConnection)new URL(baseUrl+path+(path.equals("/api/info")?"?token="+Uri.encode(token):"")).openConnection();c.setRequestMethod(method);c.setConnectTimeout(5000);c.setReadTimeout(10000);c.setRequestProperty("X-Pairing-Token",token);c.setRequestProperty("Accept","application/json");if(body!=null){c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");try(OutputStream o=c.getOutputStream()){o.write(body.toString().getBytes(StandardCharsets.UTF_8));}}int code=c.getResponseCode();InputStream in=code>=400?c.getErrorStream():c.getInputStream();String s=read(in);if(code>=400)throw new Exception(s);return new JSONObject(s);}
    String read(InputStream in)throws Exception{try(BufferedReader r=new BufferedReader(new InputStreamReader(in,StandardCharsets.UTF_8))){StringBuilder s=new StringBuilder();String l;while((l=r.readLine())!=null)s.append(l);return s.toString();}}
    @Override protected void onDestroy(){pool.shutdownNow();super.onDestroy();}
}
