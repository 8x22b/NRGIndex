const express = require("express");
const { saveProcessedImage } = require("../lib/images");

module.exports = (db, auth, config) => {
  const router = express.Router();
  router.post("/", async (req, res) => {
    const image = await saveProcessedImage(
      config.uploadsDir,
      req.body?.dataUrl,
      config.maxUploadBytes,
    );
    res.status(201).json(image);
  });
  return router;
};
