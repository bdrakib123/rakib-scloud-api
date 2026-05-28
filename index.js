require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ======================================
// AUTO CLIENT ID SYSTEM
// ======================================

let CLIENT_IDS = [];
let LAST_UPDATE = 0;

async function updateClientIds() {
  try {
    // 6 hour cache
    if (
      CLIENT_IDS.length > 0 &&
      Date.now() - LAST_UPDATE < 21600000
    ) {
      return CLIENT_IDS;
    }

    console.log("🔄 Updating SoundCloud Client IDs...");

    const html = (
      await axios.get("https://soundcloud.com", {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        },
        timeout: 20000
      })
    ).data;

    const scriptUrls = [
      ...html.matchAll(
        /https:\/\/a-v2\.sndcdn\.com\/assets\/.+?\.js/g
      )
    ].map(x => x[0]);

    const ids = new Set();

    for (const url of scriptUrls) {
      try {
        const js = (
          await axios.get(url, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
            },
            timeout: 20000
          })
        ).data;

        const matches = [
          ...js.matchAll(
            /client_id:"([a-zA-Z0-9]{32})"/g
          )
        ];

        matches.forEach(m => ids.add(m[1]));

      } catch {}
    }

    CLIENT_IDS = [...ids];
    LAST_UPDATE = Date.now();

    console.log(
      `✅ ${CLIENT_IDS.length} Client IDs Loaded`
    );

    return CLIENT_IDS;

  } catch (err) {
    console.log("❌ Failed to update IDs");

    if (CLIENT_IDS.length > 0) {
      return CLIENT_IDS;
    }

    throw new Error("No Client IDs Available");
  }
}

async function getWorkingClientId() {
  const ids = await updateClientIds();

  for (const clientId of ids) {
    try {
      await axios.get(
        "https://api-v2.soundcloud.com/search/tracks",
        {
          params: {
            q: "test",
            client_id: clientId,
            limit: 1
          },
          timeout: 10000
        }
      );

      return clientId;

    } catch {}
  }

  throw new Error("No Working Client ID");
}

// ======================================
// SEARCH TRACK
// ======================================

async function searchTrack(query, limit = 1) {
  const clientId = await getWorkingClientId();

  const response = await axios.get(
    "https://api-v2.soundcloud.com/search/tracks",
    {
      params: {
        q: query,
        client_id: clientId,
        limit
      },
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        Accept: "application/json"
      },
      timeout: 15000
    }
  );

  return {
    tracks: response.data.collection,
    clientId
  };
}

// ======================================
// GET AUDIO URL
// ======================================

async function getAudioUrl(track, clientId) {
  const transcoding =
    track.media.transcodings.find(
      t => t.format.protocol === "progressive"
    ) || track.media.transcodings[0];

  const stream = await axios.get(
    `${transcoding.url}?client_id=${clientId}`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      },
      timeout: 15000
    }
  );

  return stream.data.url;
}

// ======================================
// HOME
// ======================================

app.get("/", (req, res) => {
  res.json({
    status: true,
    creator: "Rakib",
    message: "Advanced SoundCloud API Running",
    loadedClientIds: CLIENT_IDS.length
  });
});

// ======================================
// SEARCH API
// ======================================

app.get("/soundcloud/search", async (req, res) => {
  try {
    const query = req.query.q;
    const limit = parseInt(req.query.limit) || 10;

    if (!query) {
      return res.status(400).json({
        status: false,
        message: "Query required"
      });
    }

    const { tracks } = await searchTrack(
      query,
      limit
    );

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
        track.artwork_url?.replace(
          "-large",
          "-t500x500"
        ) || track.user.avatar_url,
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
      error:
        err.response?.data ||
        err.message ||
        "Unknown error"
    });
  }
});

// ======================================
// AUDIO API
// ======================================

app.get("/soundcloud/audio", async (req, res) => {
  try {
    const query = req.query.q;

    if (!query) {
      return res.status(400).json({
        status: false,
        message: "Query required"
      });
    }

    const { tracks, clientId } =
      await searchTrack(query, 1);

    const track = tracks[0];

    if (!track) {
      return res.json({
        status: false,
        message: "No result found"
      });
    }

    const audio = await getAudioUrl(
      track,
      clientId
    );

    res.json({
      status: true,
      creator: "Rakib",
      result: {
        title: track.title,
        artist: track.user.username,
        duration: Math.floor(track.duration / 1000),
        artwork:
          track.artwork_url?.replace(
            "-large",
            "-t500x500"
          ) || track.user.avatar_url,
        url: track.permalink_url,
        audio
      }
    });

  } catch (err) {
    res.status(500).json({
      status: false,
      error:
        err.response?.data ||
        err.message ||
        "Unknown error"
    });
  }
});

// ======================================
// STREAM API
// ======================================

app.get("/soundcloud/stream", async (req, res) => {
  try {
    const query = req.query.q;

    if (!query) {
      return res.status(400).json({
        status: false,
        message: "Query required"
      });
    }

    const { tracks, clientId } =
      await searchTrack(query, 1);

    const track = tracks[0];

    if (!track) {
      return res.json({
        status: false,
        message: "No result found"
      });
    }

    const audioUrl = await getAudioUrl(
      track,
      clientId
    );

    const audioResponse = await axios({
      url: audioUrl,
      method: "GET",
      responseType: "stream",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      },
      timeout: 30000
    });

    res.setHeader("Content-Type", "audio/mpeg");

    audioResponse.data.pipe(res);

  } catch (err) {
    res.status(500).json({
      status: false,
      error:
        err.response?.data ||
        err.message ||
        "Unknown error"
    });
  }
});

// ======================================
// AUTO REFRESH IDS
// ======================================

setInterval(async () => {
  try {
    await updateClientIds();
  } catch {}
}, 21600000);

// ======================================
// START SERVER
// ======================================

app.listen(PORT, async () => {
  console.log(`🚀 Server running on ${PORT}`);

  try {
    await updateClientIds();
  } catch (err) {
    console.log("❌ Initial ID Load Failed");
  }
});
