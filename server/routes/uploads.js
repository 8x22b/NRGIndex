const express = require("express");
const { saveDataUrlImage } = require("../lib/images");

module.exports = (db, auth, config) => {
  const router = express.Router();
  router.post("/", (req, res) => {
    const path = saveDataUrlImage(config.uploadsDir, req.body?.dataUrl, config.maxUploadBytes);
    res.status(201).json({ path });
  });
  return router;
};
