const { google } = require('googleapis');
const axios = require('axios');
const { Storage } = require('@google-cloud/storage');
const fs = require('fs');

const storage = new Storage();


// Your slack webhook endpoint ("Incoming webhooks" when you create your own Slack App)
const ENDPOINT = process.env.SLACK_ENDPOINT;

const STORAGE_BUCKET = process.env.STORAGE_BUCKET || "gtm-status-monitor";
const STORAGE_FILE = "container_versions.json";

// List of containers to check. Either use accountId + containerId or name + url
const CHECK_CONTAINER_FILE = "check_containers.json";


/**
 * Get container version when we have access through a service account 
 * by passing in an authenticated tagmanager object
 * @param {object} tagmanager authenticated tag manager API object
 * @param {string} accountId internal account ID
 * @param {string} containerId internal container ID (i.e. *not* the public facing GTM-...)
 * @returns 
 */
const getLatestContainerVersionInfo = async(tagmanager, accountId, containerId) => {
    const res = await tagmanager.accounts.containers.versions.live({
        parent: `accounts/${accountId}/containers/${containerId}`,
    });

    // Return live version info
    return {
        "containerVersionId" : parseInt(res.data.containerVersionId),
        "containerId" : res.data.containerId,
        "containerInfo" : res.data.container,
        "fingerprint" : res.data.fingerprint,
        "name" : res.data.name,
        "description" : res.data.description,
        "path" : res.data.path,
        "tagManagerUrl" : res.data.tagManagerUrl
    }
}

/**
 * pass in a public URL to a tag manager container script to get the version
 * @param {string} url url to a tagmanager container script
 * @returns {int} version
 */
const getVersionFromURL = async(url) => {
    const res = await axios.get(url);
    const re = /resource.+?{.+version.+?([0-9]+)/s;
    return parseInt(res.data.slice(0,400).match(re)[1]);
}

/**
 * Get the last version for a specific container from storage
 * @param {string} id ID in format [accountId]-[containerId] for service accounts and base64 of url for URLs
 * @returns 
 */
const getStoredVersionById = async(id) => {
    let cv = await storage.bucket(STORAGE_BUCKET).file(STORAGE_FILE).download();
    cv = cv.toString('utf-8');
    cvParsed = cv.length > 1 ? JSON.parse(cv) : {};

    if (Object.keys(cvParsed).indexOf(id) > -1) {

        return cvParsed[id]
    } else {
        return 0
    }
}

const setStoredVersionById = async(id, version) => {
    let cv;
    
    // Check if a temp file already exists so we can add to it
    if(fs.existsSync(`/tmp/${STORAGE_FILE}`)) {
        cv = fs.readFileSync(`/tmp/${STORAGE_FILE}`);
    } else {
        cv = await storage.bucket(STORAGE_BUCKET).file(STORAGE_FILE).download();
        cv = cv.toString('utf-8');
    }

    cvParsed = cv.length > 1 ? JSON.parse(cv) : {};
    
    cvParsed[id] = version;

    fs.writeFileSync(`/tmp/${STORAGE_FILE}`, JSON.stringify(cvParsed))
    
    await storage.bucket(STORAGE_BUCKET).upload(`/tmp/${STORAGE_FILE}`);
}

/**
 * Publish a notification to a Slack webhook
 * @param {object} data Object containing at least the last known version, new version, container ID and name
 * @returns 
 */
const publishNotification = async(data) => {
    let messageText = "";
    if(data.containerInfo !== undefined) {
        // Detailed message
        messageText = `*Version change detected from version ${data.lastKnownVersion} to ${data.newVersion} for container ${data.containerId} (${data.containerInfo.name})*\nView changes at ${data.versionInfo.tagManagerUrl}\n- Version name: ${data.versionInfo.name}\n- Version fingerprint: ${data.versionInfo.fingerprint}\n- Version description: \n>${data.versionInfo.description}`;
    } else {
        // Simple message
        messageText = `*Version change detected from version ${data.lastKnownVersion} to ${data.newVersion} for container ${data.containerId} (${data.name})*`;
    }

    await axios.post(ENDPOINT, {
            "type" : "mrkdwn",
            "verbatim" : true,
            "text" : messageText
        }).then(res => {
            // console.log(JSON.stringify(res.data));
        }).catch(console.error)
    return
}

exports.checkStatus = async(event, context) => {
    console.log('Starting GTM status check');

    // Get list of containers to check
    let checkContainers = await storage.bucket(STORAGE_BUCKET).file(CHECK_CONTAINER_FILE).download()
    checkContainers = JSON.parse(checkContainers.toString('utf-8'))

    // Set up authentication once (don't forget to add your service account to the GTM container)
    const auth = new google.auth.GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/tagmanager.readonly"]
    });
    const authClient = await auth.getClient();
    const tagmanager = google.tagmanager({
        version: 'v2',
        auth: authClient
    });


    // Check all containers present
    await Promise.all(checkContainers.map(async(c) => {
        if(c.url !== undefined) {            
            console.log(`Checking container '${c.name}' at ${c.url}`);
            const liveVersion = await getVersionFromURL(c.url);
            
            const checkId = Buffer.from(c.url).toString('base64');
            const lastKnownVersion = await getStoredVersionById(checkId);

            if (lastKnownVersion !== liveVersion) {
                //New version detected
                await setStoredVersionById(checkId, liveVersion)
                await publishNotification({
                    newVersion: liveVersion,
                    lastKnownVersion: lastKnownVersion,
                    containerId: c.url.match(/GTM-[A-Z0-9]+/)[0],
                    name: c.name
                });
            }
        } else {
            console.log(`Checking container '${c.containerId}' for account ${c.accountId}`);
            const checkId = `${c.accountId}-${c.containerId}`;
            const liveVersionInfo = await getLatestContainerVersionInfo(tagmanager, c.accountId, c.containerId);
            const lastKnownVersion = await getStoredVersionById(checkId);

            if (lastKnownVersion !== liveVersionInfo.containerVersionId) {
                await setStoredVersionById(checkId, liveVersionInfo.containerVersionId);

                await publishNotification({
                    newVersion: liveVersionInfo.containerVersionId,
                    lastKnownVersion: lastKnownVersion,
                    containerId: liveVersionInfo.containerInfo.publicId,
                    containerInfo: liveVersionInfo.containerInfo,
                    versionInfo: liveVersionInfo
                });
            }
        }
        return
    })).then(() => {
        console.log('Check succesful')
    }).catch((err) => {
        console.error(err);
    })
    return
}