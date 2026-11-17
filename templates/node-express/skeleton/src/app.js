import express from "express";

export const app = express();
app.disable("x-powered-by");

app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

app.get("/", (_req, res) =>
  res.json({ service: "[[name]]", message: "Launched with Launchbay" })
);
