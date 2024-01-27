const dotenv = require('dotenv');
const dotenvExpand = require('dotenv-expand');

const appEnv = dotenv.config();
dotenvExpand.expand(appEnv);

const axios = require("axios");
const { io } = require('socket.io-client');

const { getObjects } = require('./libraries/utils');

const debug = (msg) => {
    if (!process.env.DEBUG) return;
    console.log(msg)
};
let monitorsList = {}

// Kerner API Instance
const kener = axios.create({
    baseURL: process.env.KENER_URL,
    timeout: 1000,
    headers: {
        'Authorization': `Bearer ${process.env.KENER_TOKEN}`,
        'Content-Type' : 'application/json'
    }
});
const updateStatus = (heart, tag, maxPing) => {
    debug('Start kenet monitor update')
    kener.post('/api/status', {
        "status": ((heart.status === 1) ? ((heart.ping  > parseInt(maxPing)) ? 'DEGRADED' : 'UP') : 'DOWN'),
        "latency": heart.ping,
        "tag": tag
    })
        .then(function (response) {
            const monitor = getObjects(monitorsList,'id', heart.monitor_id || heart.monitorID).find(item => item.type === 'push' || item.type === 'http' || item.type === 'port');
            console.log(`${monitor.name} Updated status to kener (maxPing: ${maxPing})`);

        })
        .catch(function (error) {
            debug(error)
        });
};
// Uptime Kuma Socket.io
debug(`Kuma url: ${process.env.KUMA_URL}`);
debug(`Kener url: ${process.env.KENER_URL}`);
const kuma = io(process.env.KUMA_URL);

kuma.on("connect", () => {
  console.log('connected')
  kuma.emit("login", { username: process.env.KUMA_USER,  password: process.env.KUMA_PASS,  token: null }, (res) => {
        if (res.tokenRequired) {
            console.log('Error 2FA enabled on this account');
            return kuma.disconnect();
        }

        if (res.ok) {
            kuma.uptime_kuma_token = res.token;
            console.log('Logged on socket');
        } else {
            console.log('An error has occurred');
            console.log(res, 'error');
            return kuma.disconnect();
        }
    });
})

kuma.on("connect_error", (err) => {
   console.log(`Failed to connect to the backend. Socket.io connect_error: ${err.message}`);
});

kuma.on("disconnect", () => {
    console.log(`disconnected from the socket server `);
});

kuma.on("monitorList", async (monitors) => {
    console.log(`Update Uptime Kuma monitors`);

    monitorsList = monitors;
});

kuma.on("heartbeatList", (monitorID, data, overwrite = false) => {
    const monitor = getObjects(monitorsList,'id', monitorID).find(item => item.type === 'push' || item.type === 'http' || item.type === 'port');
    if (monitor === undefined) return;

    const tag = monitor.tags.find(item => item.name === 'Kener');
    const maxPing = monitor.tags.find(item => item.name === 'MaxPing');
    if (tag !== null && tag !== undefined) {
        const heart = data[data.length-1];
        updateStatus(heart, tag.value, ((maxPing !== null && maxPing !== undefined) ? maxPing.value : 2000));
    }
});

kuma.on("heartbeat", (data) => {
    const monitor = getObjects(monitorsList,'id', data.monitorID).find(item => item.type === 'push' || item.type === 'http' || item.type === 'port');
    if (monitor === undefined) return;

    const tag = monitor.tags.find(item => item.name === 'Kener');
    const maxPing = monitor.tags.find(item => item.name === 'MaxPing');
    if (tag !== null && tag !== undefined) {
        updateStatus(data, tag.value, ((maxPing !== null && maxPing !== undefined) ? maxPing.value : 2000));
    }
});