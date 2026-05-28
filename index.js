const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// =======================
// CLIENT ID CACHE
// =======================

let cachedClientId = null;
let lastFetch = 0;

async function getClientId() {
  try {
    // cache 1 hour
    if (cachedClientId && Date.now() - lastFetch < 3600000) {
      return cachedClientId;
    }

    const html = (await axios.get("https://soundcloud.com")).data;

    // js files
    const scriptUrls = [
      ...html.matchAll(
        /https:\/\/a-v2\.sndcdn\.com\/assets\/.+?\.js/g
      )
    ].map(x => x[0]);

    for (const url of scriptUrls) {
      try {
        const js = (await axios.get(url)).data;

        const match = js.match(/client_id:\s*"([a-zA-Z0-9]{32})"/);

        if (match && match[1]) {
          cachedClientId = match[1];
          lastFetch = Date.now();

          console.log("✅ New Client ID:", cachedClientId);

          return cachedClientId;
        }

      } catch {}
    }

    throw new Error("Client ID not found");

  } catch (err) {
    throw new Error("Failed to fetch client ID");
  }
}

// =======================
// HOME
// =======================

app.get("/", (req, res) => {
  res.json({
    status: true,
    creator: "Rakib",
    message: "SoundCloud API Running"
  });
});

// =======================
// SEARCH API
// =======================

app.get("/soundcloud/search", async (req, res) => {
  try {
    const query = req.query.q;
    const limit = req.query.limit || 10;

    if (!query) {
      return res.status(400).json({
        status: false,
        message: "Query required"
      });
    }

    const clientId = await getClientId();

    const response = await axios.get(
      "https://api-v2.soundcloud.com/search/tracks",
      {
        params: {
          q: query,
          client_id: clientId,
          limit
        }
      }
    );

    const tracks = response.data.collection;

    if (!tracks.length) {
      return res.json({
        status: false,
        message: "No results found"
      });
    }

    const results = tracks.map(track => ({
      title: track.title,
      artist: track.user.username,
      duration: Math.floor(track.duration / 1000),
      artwork:
        track.artwork_url?.replace("-large", "-t500x500") ||
        track.user.avatar_url,
      url: track.permalink_url
    }));

    res.json({
      status: true,
      total: results.length,
      result: results
    });

  } catch (err) {
    res.status(500).json({
      status: false,
      error: err.message
    });
  }
});

// =======================
// AUDIO API
// =======================

app.get("/soundcloud/audio", async (req, res) => {
  try {
    const query = req.query.q;

    if (!query) {
      return res.status(400).json({
        status: false,
        message: "Query required"
      });
    }

    const clientId = await getClientId();

    // Search first track
    const search = await axios.get(
      "https://api-v2.soundcloud.com/search/tracks",
      {
        params: {
          q: query,
          client_id: clientId,
          limit: 1
        }
      }
    );

    const track = search.data.collection[0];

    if (!track) {
      return res.json({
        status: false,
        message: "No result found"
      });
    }

    // Get stream URL
    const transcoding =
      track.media.transcodings.find(
        t => t.format.protocol === "progressive"
      ) ||
      track.media.transcodings[0];

    const stream = await axios.get(
      `${transcoding.url}?client_id=${clientId}`
    );

    res.json({
      status: true,
      creator: "Rakib",
      result: {
        title: track.title,
        artist: track.user.username,
        duration: Math.floor(track.duration / 1000),
        artwork:
          track.artwork_url?.replace("-large", "-t500x500") ||
          track.user.avatar_url,
        url: track.permalink_url,
        audio: stream.data.url
      }
    });

  } catch (err) {
    res.status(500).json({
      status: false,
      error: err.message
    });
  }
});

// =======================
// STREAM API
// =======================

app.get("/soundcloud/stream", async (req, res) => {
  try {
    const query = req.query.q;

    if (!query) {
      return res.status(400).json({
        status: false,
        message: "Query required"
      });
    }

    const clientId = await getClientId();

    // Search
    const search = await axios.get(
      "https://api-v2.soundcloud.com/search/tracks",
      {
        params: {
          q: query,
          client_id: clientId,
          limit: 1
        }
      }
    );

    const track = search.data.collection[0];

    if (!track) {
      return res.json({
        status: false,
        message: "No result found"
      });
    }

    const transcoding =
      track.media.transcodings.find(
        t => t.format.protocol === "progressive"
      ) ||
      track.media.transcodings[0];

    const stream = await axios.get(
      `${transcoding.url}?client_id=${clientId}`
    );

    const audioResponse = await axios({
      url: stream.data.url,
      method: "GET",
      responseType: "stream"
    });

    res.setHeader("Content-Type", "audio/mpeg");

    audioResponse.data.pipe(res);

  } catch (err) {
    res.status(500).json({
      status: false,
      error: err.message
    });
  }
});

// =======================
// START SERVER
// =======================

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
