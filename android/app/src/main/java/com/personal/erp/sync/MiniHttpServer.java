package com.personal.erp.sync;

import android.content.Context;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Enumeration;

/**
 * 极简 HTTP 服务器（无第三方依赖，ServerSocket 实现）：
 *   GET  /health          健康检查
 *   GET  /backup          拉取最新备份
 *   PUT  /backup          推送备份（?force=1 强制覆盖）
 *   GET  /backup/history  历史备份列表
 * 数据存 App 内部目录 files/sync_backups/（冗余保留 10 份），
 * 与 JS 侧 SharedPreferences("CapacitorStorage") 的 db 保持一致（PUT 时同步写入）。
 */
public class MiniHttpServer {
  private static final int MAX_BACKUPS = 10;
  private final Context ctx;
  private final int port;
  private ServerSocket server;
  private volatile boolean running = false;

  public MiniHttpServer(Context ctx, int port) {
    this.ctx = ctx;
    this.port = port;
  }

  public void start() throws Exception {
    server = new ServerSocket(port);
    running = true;
    Thread t = new Thread(this::acceptLoop, "erp-sync-server");
    t.setDaemon(true);
    t.start();
  }

  public void stop() {
    running = false;
    try { if (server != null) server.close(); } catch (Exception ignored) {}
  }

  public boolean isRunning() { return running; }

  private void acceptLoop() {
    while (running) {
      try {
        Socket s = server.accept();
        handle(s);
      } catch (Exception ignored) {}
    }
  }

  private void handle(Socket s) {
    try {
      s.setSoTimeout(5000);
      BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
      String line = in.readLine();
      if (line == null) { s.close(); return; }
      String[] parts = line.split(" ");
      String method = parts[0];
      String path = parts.length > 1 ? parts[1] : "/";
      int contentLength = 0;
      String h;
      while ((h = in.readLine()) != null && !h.isEmpty()) {
        if (h.toLowerCase().startsWith("content-length:")) {
          contentLength = Integer.parseInt(h.substring(15).trim());
        }
      }
      String body = "";
      if (contentLength > 0) {
        char[] buf = new char[contentLength];
        int n = in.read(buf, 0, contentLength);
        if (n > 0) body = new String(buf, 0, n);
      }
      String resp = route(method, path, body);
      byte[] out = resp.getBytes(StandardCharsets.UTF_8);
      OutputStream os = s.getOutputStream();
      os.write(("HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\n"
          + "Content-Length: " + out.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
      os.write(out);
      os.flush();
      s.close();
    } catch (Exception ignored) {}
  }

  private String route(String method, String path, String body) {
    try {
      String p = path.split("\\?")[0];
      boolean force = path.contains("force=1");
      if ("GET".equals(method) && p.equals("/health")) {
        return "{\"ok\":true,\"time\":" + System.currentTimeMillis() + "}";
      }
      if ("GET".equals(method) && p.equals("/backup")) {
        File f = latestFile();
        return f == null ? "{\"error\":\"no backup yet\"}" : readFile(f);
      }
      if ("GET".equals(method) && p.equals("/backup/history")) {
        File[] files = backupFiles();
        StringBuilder sb = new StringBuilder("[");
        if (files != null) {
          Arrays.sort(files, Comparator.comparingLong(File::lastModified).reversed());
          for (int i = 0; i < files.length; i++) {
            if (i > 0) sb.append(",");
            sb.append("{\"name\":\"").append(files[i].getName())
              .append("\",\"size\":").append(files[i].length())
              .append(",\"mtime\":").append(files[i].lastModified()).append("}");
          }
        }
        return sb.append("]").toString();
      }
      if ("PUT".equals(method) && p.equals("/backup")) {
        JSONObject obj = new JSONObject(body);
        if (!obj.has("db") || !obj.has("exportedAt")) return "{\"error\":\"missing db/exportedAt\"}";
        if (!force) {
          File cur = latestFile();
          if (cur != null) {
            JSONObject curObj = new JSONObject(readFile(cur));
            if (curObj.optString("exportedAt", "").compareTo(obj.optString("exportedAt", "")) > 0) {
              return "{\"error\":\"conflict\",\"server\":" + curObj + "}";
            }
          }
        }
        File dir = new File(ctx.getFilesDir(), "sync_backups");
        dir.mkdirs();
        String stamp = obj.optString("exportedAt", "").replaceAll("[^0-9]", "");
        if (stamp.length() > 14) stamp = stamp.substring(0, 14);
        File f = new File(dir, "backup_" + stamp + ".json");
        writeFile(f, body);
        // 冗余：只保留最近 MAX_BACKUPS 份
        File[] files = backupFiles();
        if (files != null && files.length > MAX_BACKUPS) {
          Arrays.sort(files, Comparator.comparingLong(File::lastModified));
          for (int i = 0; i < files.length - MAX_BACKUPS; i++) files[i].delete();
        }
        return "{\"ok\":true,\"name\":\"" + f.getName() + "\"}";
      }
      return "{\"error\":\"not found\"}";
    } catch (Exception e) {
      return "{\"error\":\"" + (e.getMessage() == null ? "server error" : e.getMessage()) + "\"}";
    }
  }

  private File[] backupFiles() {
    File dir = new File(ctx.getFilesDir(), "sync_backups");
    return dir.listFiles((d, n) -> n.startsWith("backup_") && n.endsWith(".json"));
  }

  private File latestFile() {
    File[] files = backupFiles();
    if (files == null || files.length == 0) return null;
    Arrays.sort(files, Comparator.comparingLong(File::lastModified));
    return files[files.length - 1];
  }

  private static String readFile(File f) throws Exception {
    byte[] b = java.nio.file.Files.readAllBytes(f.toPath());
    return new String(b, StandardCharsets.UTF_8);
  }

  private static void writeFile(File f, String content) throws Exception {
    java.nio.file.Files.write(f.toPath(), content.getBytes(StandardCharsets.UTF_8));
  }

  /** 本机局域网 IPv4（供前端展示服务地址） */
  public static String localIp() {
    try {
      Enumeration<NetworkInterface> nis = NetworkInterface.getNetworkInterfaces();
      while (nis.hasMoreElements()) {
        NetworkInterface ni = nis.nextElement();
        if (!ni.isUp() || ni.isLoopback()) continue;
        Enumeration<InetAddress> addrs = ni.getInetAddresses();
        while (addrs.hasMoreElements()) {
          InetAddress ia = addrs.nextElement();
          if (ia instanceof Inet4Address && !ia.isLoopbackAddress()) return ia.getHostAddress();
        }
      }
    } catch (Exception ignored) {}
    return "0.0.0.0";
  }
}