import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

const app = new Hono();

// ルートで demo/index.html を配信
app.get("/", serveStatic({ root: "./demo" }));

// dist 配信（demo は dist/index.mjs を直接読む）
app.get("/dist/*", serveStatic({ root: "./" }));

// CORS ヘッダ
app.use("*", (c, next) => {
	c.header("Access-Control-Allow-Origin", "*");
	return next();
});

serve({ fetch: app.fetch, port: 40299 });

console.log("Server running at http://localhost:40299");
