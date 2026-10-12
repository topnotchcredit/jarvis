// Local stand-in for the Supabase API gateway and an email inbox, for end-to-end tests only.
//   :54321  /auth/v1/* -> auth server, /rest/v1/* -> PostgREST
//   :2525   SMTP sink; captured messages are readable at http://127.0.0.1:54321/__mail
import http from "node:http";
import net from "node:net";

const routes = { "/auth/v1": 9999, "/rest/v1": 3001 };
const mail = [];

http
  .createServer((req, res) => {
    if (req.url === "/__mail") {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify(mail));
    }
    const prefix = Object.keys(routes).find((p) => req.url.startsWith(p));
    if (!prefix) {
      res.statusCode = 404;
      return res.end("not found");
    }
    const upstream = http.request(
      { host: "127.0.0.1", port: routes[prefix], method: req.method, path: req.url.slice(prefix.length) || "/", headers: req.headers },
      (up) => {
        res.writeHead(up.statusCode, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.statusCode = 502;
      res.end("upstream unavailable");
    });
    req.pipe(upstream);
  })
  .listen(54321, "127.0.0.1");

net
  .createServer((socket) => {
    let data = "", inBody = false, body = "", to = "";
    socket.write("220 local ESMTP\r\n");
    socket.on("data", (chunk) => {
      data += chunk.toString("utf8");
      let index;
      while ((index = data.indexOf("\r\n")) >= 0) {
        const line = data.slice(0, index);
        data = data.slice(index + 2);
        if (inBody) {
          if (line === ".") {
            inBody = false;
            mail.push({ to, body: Buffer.from(body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8") });
            body = "";
            socket.write("250 ok\r\n");
          } else body += line + "\n";
          continue;
        }
        const cmd = line.toUpperCase();
        if (cmd.startsWith("EHLO") || cmd.startsWith("HELO")) socket.write("250 local\r\n");
        else if (cmd.startsWith("RCPT TO")) { to = line.slice(8).replace(/[<>]/g, "").trim(); socket.write("250 ok\r\n"); }
        else if (cmd === "DATA") { inBody = true; socket.write("354 go\r\n"); }
        else if (cmd === "QUIT") { socket.write("221 bye\r\n"); socket.end(); }
        else socket.write("250 ok\r\n");
      }
    });
    socket.on("error", () => {});
  })
  .listen(2525, "127.0.0.1");
