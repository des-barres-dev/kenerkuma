const dotenv = require('dotenv');
const dotenvExpand = require('dotenv-expand');


const appEnv = dotenv.config();
dotenvExpand.expand(appEnv);

const Logger = require("@ptkdev/logger");
const axios = require("axios");
const { CronJob } = require('cron');
const { io } = require('socket.io-client');

const { getObjects } = require('./libraries/utils');

const logger = new Logger();

const debug = (msg) => {
    if (!process.env.DEBUG) return;
    console.log(msg)
};
let monitorsList = {}
let lastHeartbeat = {}

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
    logger.info("Start monitor update", "Kener");
    kener.post('/api/status', {
        "status": ((heart.status === 1) ? ((heart.ping  > parseInt(maxPing)) ? 'DEGRADED' : 'UP') : 'DOWN'),
        "latency": heart.ping || 0,
        "timestampInSeconds": Math.round(Date.now() / 1000),
        "tag": tag
    })
        .then(function (response) {
            const monitor = getObjects(monitorsList,'id', heart.monitor_id || heart.monitorID).find(item => item.type === 'push' || item.type === 'http' || item.type === 'port' || item.type === 'gamedig');

            logger.info(`${monitor.name} Updated status (maxPing: ${maxPing})`, "Kener");
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
    logger.info("Connected to socket", "UptimeKuma");
    kuma.emit("login", { username: process.env.KUMA_USER,  password: process.env.KUMA_PASS,  token: null }, (res) => {
        if (res.tokenRequired) {
            logger.error("Error 2FA enabled on this account", "UptimeKuma");
            return kuma.disconnect();
        }

        if (res.ok) {
            kuma.uptime_kuma_token = res.token;
            logger.info("Logged In", "UptimeKuma");
        } else {
            logger.error("An error has occurred", "UptimeKuma");
            console.log(res, 'error');
            return kuma.disconnect();
        }
    });
})

kuma.on("connect_error", (err) => {
    logger.error(`Failed to connect to the backend. Socket.io connect_error: ${err.message}`, "UptimeKuma");
});

kuma.on("disconnect", () => {
    logger.error(`disconnected from the socket server`, "UptimeKuma");
});

kuma.on("monitorList", async (monitors) => {
    logger.info(`Receive ${Object.keys(monitors).length} Monitors from UptimeKuma `, "Bridge");
    monitorsList = monitors;
});

kuma.on("heartbeatList", (monitorID, data, overwrite = false) => {
    const monitor = getObjects(monitorsList,'id', monitorID).find(item => item.type === 'push' || item.type === 'http' || item.type === 'port' || item.type === 'gamedig');

    logger.info(`Receive list for monitor #${monitorID} (${monitor.name})`, "Heartbeat List");

    if (monitor === undefined) return;
    const tag = monitor.tags.find(item => item.name === 'Kener');
    const maxPing = monitor.tags.find(item => item.name === 'MaxPing');
    if (tag !== null && tag !== undefined) {
        const heart = data[data.length-1];
        lastHeartbeat[monitorID] = heart;
        lastHeartbeat[monitorID]['timestamp'] = Date.now();
        updateStatus(heart, tag.value, ((maxPing !== null && maxPing !== undefined) ? maxPing.value : 2000));
    }
});

kuma.on("heartbeat", (data) => {
    const monitor = getObjects(monitorsList,'id', data.monitorID).find(item => item.type === 'push' || item.type === 'http' || item.type === 'port' || item.type === 'gamedig');

    logger.info(`Receive for monitor #${data.monitorID} (${monitor.name})`, "Heartbeat");
    if (monitor === undefined) return;
    const tag = monitor.tags.find(item => item.name === 'Kener');
    lastHeartbeat[data.monitorID] = data;
    lastHeartbeat[data.monitorID]['timestamp'] = Date.now();
    const maxPing = monitor.tags.find(item => item.name === 'MaxPing');
    if (tag !== null && tag !== undefined) {
        updateStatus(data, tag.value, ((maxPing !== null && maxPing !== undefined) ? maxPing.value : 2000));
    }
});

kuma.on("uptime", (monitorID, dd, gg) => {
    const monitor = getObjects(monitorsList,'id', monitorID).find(item => item.type === 'push' || item.type === 'http' || item.type === 'port' || item.type === 'gamedig');

    logger.info(`Receive for monitor #${monitorID} (${monitor.name})`, "Uptime");
    const lh = lastHeartbeat[monitorID]
    if (lh) {
        const cur = Date.now();
        const tag = monitor.tags.find(item => item.name === 'Kener')
        const maxPing = monitor.tags.find(item => item.name === 'MaxPing');
        if ((cur - lh.timestamp) >= 30 && tag !== undefined) {
            console.log((cur - lh.timestamp))
            updateStatus(lh, tag.value, ((maxPing !== null && maxPing !== undefined) ? maxPing.value : 2000));
            lastHeartbeat[monitorID]['timestamp'] = Date.now();
        }
    }
});

const job = CronJob.from({
	cronTime: '0 */1 * * * *',
	onTick: function () {

    logger.info(`Cron as triggered`, "Cron");
        for (const mon in lastHeartbeat) {
            const heartbeat = lastHeartbeat[mon];

            const monitor = getObjects(monitorsList,'id', heartbeat.monitorID).find(item => item.type === 'push' || item.type === 'http' || item.type === 'port' || item.type === 'gamedig');
            if (monitor !== null && monitor !== undefined) {
                const tag = monitor.tags.find(item => item.name === 'Kener')
                const maxPing = monitor.tags.find(item => item.name === 'MaxPing');
                if (tag !== null && tag !== undefined) {
                    updateStatus(heartbeat, tag.value, ((maxPing !== null && maxPing !== undefined) ? maxPing.value : 2000));
                }
            }
        }
	},
	start: true,
	timeZone: 'Europe/Paris'
});