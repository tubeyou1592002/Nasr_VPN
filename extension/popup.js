const API = "http://127.0.0.1:8765";

const CACHE_KEY = "vpnProfilesCache";
const CACHE_TIME_KEY = "vpnProfilesCacheTime";

const settingsButton =
    document.getElementById("settings");


const settingsPanel =
    document.getElementById("settings-panel");


const saveSettingsButton =
    document.getElementById("save-settings");


const subscriptionInput =
    document.getElementById("subscription-url");


const autoReconnectInput =
    document.getElementById("auto-reconnect-setting");


const intervalInput =
    document.getElementById("check-interval");


const settingsStatus =
    document.getElementById("settings-status");

// Cache lifetime:
// 10 minutes
const CACHE_MAX_AGE = 10 * 60 * 1000;


let selectedIndex = null;
let profiles = [];


const serversElement =
    document.getElementById("servers");

const statusElement =
    document.getElementById("status");

const vpnStatusElement =
    document.getElementById("vpn-status");    


const refreshButton =
    document.getElementById("refresh");

const connectButton =
    document.getElementById("connect");

const disconnectButton =
    document.getElementById("disconnect");

const autoConnectButton =
    document.getElementById("auto-connect");


// ========================================
// Helpers
// ========================================

function escapeHtml(value) {

    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


function getLatencyClass(server) {

    if (
        server.status !== "online" ||
        server.latency === null ||
        server.latency === undefined
    ) {
        return "offline";
    }


    const latency =
        Number(server.latency);


    if (latency < 100) {
        return "fast";
    }


    if (latency < 200) {
        return "medium";
    }


    return "slow";
}


function getLatencyText(server) {

    if (server.status === "ignored") {
        return "Ignored";
    }


    if (
        server.status !== "online" ||
        server.latency === null ||
        server.latency === undefined
    ) {
        return "Offline";
    }


    return `${Number(server.latency)} ms`;
}

async function loadSettings(){

    const data =
        await chrome.storage.local.get([
            "subscription",
            "autoReconnect",
            "interval"
        ]);


    if(subscriptionInput){

        subscriptionInput.value =
            data.subscription || "";

    }


    if(autoReconnectInput){

        autoReconnectInput.checked =
            data.autoReconnect ?? true;

    }


    if(intervalInput){

        intervalInput.value =
            data.interval ?? 30;

    }

}



async function saveSettings(){

    await chrome.storage.local.set({

        subscription:
            subscriptionInput.value.trim(),


        autoReconnect:
            autoReconnectInput.checked,


        interval:
            Number(intervalInput.value)

    });


    settingsStatus.textContent =
        "Saved ✓";


    setTimeout(()=>{

        settingsStatus.textContent="";

    },2000);

    await fetch(
    `${API}/api/subscription`,
    {
        method:"POST",

        headers:{
            "Content-Type":
                "application/json"
        },

        body:JSON.stringify({
            url: subscription
        })
    }
);

}
const subscription =
    subscriptionInput.value.trim();




// ========================================
// Connection UI
// ========================================

function setConnectedUI(connected) {


    if (connectButton) {

        connectButton.disabled =
            connected;

    }


    if (disconnectButton) {

        disconnectButton.disabled =
            !connected;

    }


    if (autoConnectButton) {

        autoConnectButton.disabled =
            connected;

    }



    const vpnCard =
        document.getElementById(
            "vpn-card"
        );


    const vpnStatus =
        document.getElementById(
            "vpn-status"
        );



    if (
        vpnCard &&
        vpnStatus
    ) {


        if (connected) {


            vpnCard.classList.remove(
                "disconnected"
            );


            vpnCard.classList.add(
                "connected"
            );


            vpnStatus.textContent =
                "Connected";


        }
        else {


            vpnCard.classList.remove(
                "connected"
            );


            vpnCard.classList.add(
                "disconnected"
            );


            vpnStatus.textContent =
                "Disconnected";


        }

    }

}

function updateVPNStatus(
    connected,
    latency=null
){

    if(!vpnStatusElement)
        return;


    if(connected){

        if(latency !== null){

            vpnStatusElement.className =
                "vpn-status connected";


            vpnStatusElement.textContent =
                latency
                ? `🟢 Connected · ${latency} ms`
                : "🟢 Connected";

        }
        else {

        vpnStatusElement.className =
            "vpn-status disconnected";


        vpnStatusElement.textContent =
            "⚪ Disconnected";

        }

    }
    else {

        vpnStatusElement.textContent =
            "⚪ Disconnected";

    }

}
// ========================================
// State
// ========================================

async function saveState(latency=null) {

    await chrome.storage.local.set({

        connected:true,

        selectedIndex:selectedIndex,

        latency:latency

    });
}

async function clearState() {

    await chrome.storage.local.remove([
        "connected",
        "selectedIndex",
        "latency"
    ]);
}


async function loadState() {

    const data =
        await chrome.storage.local.get([
            "connected",
            "selectedIndex",
            "latency"
        ]);

   if(data.connected){

        statusElement.textContent =
            data.latency
                ? `Connected · ${data.latency} ms`
                : "Connected";


        selectedIndex =
            Number(data.selectedIndex);

    }


    if (
        data.selectedIndex !== undefined &&
        data.selectedIndex !== null
    ) {

        selectedIndex =
            data.selectedIndex;
    }


    const connected =
        data.connected === true;


    setConnectedUI(
        connected
    );


     updateVPNStatus(
        connected,
        data.latency
     );
}


// ========================================
// Cache
// ========================================

async function saveProfilesCache(
    newProfiles
) {

    await chrome.storage.local.set({

        [CACHE_KEY]:
            newProfiles,

        [CACHE_TIME_KEY]:
            Date.now()
    });
}


async function loadProfilesCache() {

    const data =
        await chrome.storage.local.get([
            CACHE_KEY,
            CACHE_TIME_KEY
        ]);


    if (
        !Array.isArray(
            data[CACHE_KEY]
        )
    ) {

        return null;
    }


    const cacheTime =
        Number(
            data[CACHE_TIME_KEY] || 0
        );


    const cacheAge =
        Date.now() - cacheTime;


    return {

        profiles:
            data[CACHE_KEY],

        age:
            cacheAge,

        fresh:
            cacheAge <= CACHE_MAX_AGE
    };
}


// ========================================
// Render servers
// ========================================

function renderServers() {

    serversElement.innerHTML = "";


    if (!Array.isArray(profiles)) {
        profiles = [];
    }


    if (profiles.length === 0) {

        serversElement.innerHTML = `
            <div class="empty">
                No servers found
            </div>
        `;

        return;
    }


    profiles.forEach(
        (server, position) => {

            if (
                !server ||
                typeof server !== "object"
            ) {
                return;
            }


            const index =
                Number.isInteger(server.index)
                    ? server.index
                    : position;



            const scheme =
                server.scheme
                    ? String(server.scheme).toUpperCase()
                    : "VPN";



            const hostname =
                server.server ||
                "Unknown";



            const latencyText =
                getLatencyText(server);



            const latencyClass =
                getLatencyClass(server);



            const card =
                document.createElement("div");


            card.className =
                "server-card";



            if (
                selectedIndex === index
            ) {

                card.classList.add(
                    "selected"
                );

            }



            card.innerHTML = `

                <div class="server-info">


                    <div class="server-name">

                        ${escapeHtml(hostname)}

                    </div>


                    <div class="server-details">

                        ${escapeHtml(scheme)}

                    </div>


                </div>



                <div class="latency ${latencyClass}">

                    ${escapeHtml(latencyText)}

                </div>

            `;



            card.addEventListener(
                "click",
                () => {

                    selectedIndex = index;


                    renderServers();


                    if (statusElement) {

                        statusElement.textContent =
                            "Selected";

                    }

                }
            );



            serversElement.appendChild(card);

        }
    );
}


// ========================================
// Show cached servers immediately
// ========================================

async function showCachedServers() {

    const cached =
        await loadProfilesCache();


    if (!cached) {
        return false;
    }


    profiles =
        cached.profiles;


    renderServers();


    const seconds =
        Math.floor(
            cached.age / 1000
        );


    if (
        cached.age <=
        CACHE_MAX_AGE
    ) {
const state =
    await chrome.storage.local.get([
        "connected",
        "latency"
    ]);

if(state.connected){

    statusElement.textContent =
        state.latency
            ? `Connected · ${state.latency} ms`
            : "Connected";

    return true;
}
        statusElement.textContent =
            `${profiles.length} servers`;

    }
    else {

        statusElement.textContent =
            `${profiles.length} cached · updating...`;
    }


    return true;
}


// ========================================
// Download + ping fresh servers
// ========================================
async function loadCachedServers(){

    const data = await chrome.storage.local.get([
        "profiles"
    ]);


    if(data.profiles && data.profiles.length){

        profiles = data.profiles;

        renderServers();

        statusElement.textContent =
            `${profiles.length} servers cached`;

    }

}

async function loadServers(
    showLoading = true
) {

    if (showLoading) {

        statusElement.textContent =
            "Testing servers...";


        serversElement.innerHTML = `
            <div class="loading">
                Downloading and testing servers...
            </div>
        `;
    }


    try {

        const response =
            await fetch(
                `${API}/api/profiles`
            );


        const data =
            await response.json();


        if (!response.ok) {

            throw new Error(
                data.detail ||
                `HTTP ${response.status}`
            );
        }


        if (
            !data.profiles ||
            !Array.isArray(
                data.profiles
            )
        ) {

            throw new Error(
                "Invalid server list"
            );
        }


        profiles =
            data.profiles;
         
        await chrome.storage.local.set({

             profiles: profiles

        });    


        // Save fresh results.
        await saveProfilesCache(
            profiles
        );


        renderServers();


        // Restore selected server.
        const selected =
            profiles.find(
                server =>
                    Number(server.index) ===
                    Number(selectedIndex)
            );

        const state =
            await chrome.storage.local.get([
                "connected",
                "latency",
                "selectedIndex"
            ]);

        console.log("VPN STATE:", state);
        console.log("SELECTED:", selectedIndex);
        console.log("PROFILES:", profiles.length);


        if (state.connected) {

            statusElement.textContent =
                state.latency
                    ? `Connected · ${state.latency} ms`
                    : "Connected";
        }
        else if (
            selected
        ) {

            statusElement.textContent =
                "Selected";


        }

        else {

            const state =
                await chrome.storage.local.get([
                    "connected",
                    "latency"
                ]);

            if(state.connected){

                statusElement.textContent =
                    state.latency
                    ? `Connected · ${state.latency} ms`
                    : "Connected";

            }
else {

    const state =
        await chrome.storage.local.get([
            "connected",
            "latency"
        ]);


    if(state.connected){

        statusElement.textContent =
            state.latency
                ? `Connected · ${state.latency} ms`
                : "Connected";

    }
    else {

        statusElement.textContent =
            `${profiles.length} servers`;

    }

}
        }

    }
    catch (error) {

        console.error(
            "LOAD SERVERS ERROR:",
            error
        );


        // Important:
        // If fresh loading fails, keep cache.
        if (profiles.length > 0) {

            statusElement.textContent =
                `${profiles.length} cached`;

            return;
        }


        profiles = [];


        serversElement.innerHTML = `
            <div class="error">
                Backend connection failed.
                <br><br>
                ${escapeHtml(
                    error.message
                )}
            </div>
        `;


        statusElement.textContent =
            "Backend unavailable";
    }
}


// ========================================
// Connect
// ========================================

async function connect() {

    console.log("CONNECT BUTTON CLICKED");

    if (selectedIndex === null) {

        statusElement.textContent =
            "Select a server first";

        return;
    }


    const selected =
        profiles.find(
            profile =>
                profile.index ===
                selectedIndex
        );


    if (!selected) {

        statusElement.textContent =
            "Selected server not found";

        return;
    }


    statusElement.textContent =
        "Starting VPN...";


    try {

        const response =
            await fetch(
                `${API}/api/connect`,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        index:
                            selectedIndex
                    })
                }
            );


        const data =
            await response.json();


        if (!response.ok) {

            throw new Error(
                data.detail ||
                `HTTP ${response.status}`
            );
        }


        if (!data.profile) {

            throw new Error(
                "Backend did not return profile"
            );
        }


        statusElement.textContent =
            "Enabling Chrome proxy...";


        const proxyResult =
            await chrome.runtime.sendMessage(
                {
                    action:
                        "setProxy",

                    host:
                        "127.0.0.1",

                    port:
                        2080
                }
            );
            console.log(
                "POPUP PROXY RESPONSE:",
                proxyResult
            );


        if (
            !proxyResult ||
            !proxyResult.success
        ) {

            try {

                await fetch(
                    `${API}/api/disconnect`,
                    {
                        method: "POST"
                    }
                );

            }
            catch (stopError) {

                console.error(
                    stopError
                );
            }


            throw new Error(
                proxyResult?.error ||
                "Could not enable Chrome proxy"
            );
        }


        const latency =
            data.profile.latency;


        await saveState(latency);

        await chrome.storage.local.set({

            userDisconnected:false

        });


        setConnectedUI(
            true
        );

        statusElement.textContent =
            data.profile.latency !== null &&
            data.profile.latency !== undefined
                ? `Connected · ${data.profile.latency} ms`
                : "Connected";

        updateVPNStatus(
            true,
            latency
        );

        if (
            latency !== null &&
            latency !== undefined
        ) {

            statusElement.textContent =
                `Connected · ${latency} ms`;

        }
        else {

            updateVPNStatus(
                true,
                latency
            );

statusElement.textContent =
    `${profiles.length} servers`;        }


    }
    catch (error) {

        console.error(
            "CONNECT ERROR:",
            error
        );


        await clearState();


        setConnectedUI(
            false
        );


        statusElement.textContent =
            "Connect failed";


        serversElement.insertAdjacentHTML(
            "afterbegin",
            `
            <div class="error">
                ${escapeHtml(
                    error.message
                )}
            </div>
            `
        );
    }
}


// ========================================
// Disconnect
// ========================================

async function disconnect() {

    statusElement.textContent =
        "Disconnecting...";


    try {

        const proxyResult =
            await chrome.runtime.sendMessage(
                {
                    action:
                        "clearProxy"
                }
            );


        if (
            proxyResult &&
            !proxyResult.success
        ) {

            console.warn(
                proxyResult.error
            );
        }


        const response =
            await fetch(
                `${API}/api/disconnect`,
                {
                    method: "POST"
                }
            );


        if (!response.ok) {

            const data =
                await response.json();

            throw new Error(
                data.detail ||
                `HTTP ${response.status}`
            );
        }


        await clearState();


        await chrome.storage.local.set({

            userDisconnected: true

        });


        selectedIndex = null;

        setConnectedUI(
            false
        );


        renderServers();


     updateVPNStatus(
        false
     );

     statusElement.textContent =
        `${profiles.length} servers`;


    }
    catch (error) {

        console.error(
            "DISCONNECT ERROR:",
            error
        );


        statusElement.textContent =
            `Error: ${error.message}`;
    }
}


// ========================================
// Auto Connect
// ========================================

async function autoConnect() {

    if (!profiles.length) {

        await showCachedServers();
    }


    // If there is no cache at all,
    // download fresh data.
    if (!profiles.length) {

        await loadServers();
    }


    if (!profiles.length) {

        statusElement.textContent =
            "No servers available";

        return;
    }


    const fastest =
        profiles.find(
            server =>
                server.status === "online" &&
                server.latency !== null &&
                server.latency !== undefined
        );


    if (!fastest) {

        statusElement.textContent =
            "No online server found";

        return;
    }


    selectedIndex =
        fastest.index;


    renderServers();


    await connect();
}


// ========================================
// Buttons
// ========================================

console.log(
    "SETTINGS:",
    settingsButton,
    settingsPanel
);

if (refreshButton) {

    refreshButton.addEventListener(
        "click",
        async () => {

            statusElement.textContent =
                "Refreshing...";


            await loadServers(true);

        }
    );

}




if (connectButton) {

    connectButton.addEventListener(
        "click",
        connect
    );

}




if (disconnectButton) {

    disconnectButton.addEventListener(
        "click",
        disconnect
    );

}




if (autoConnectButton) {

    autoConnectButton.addEventListener(
        "click",
        autoConnect
    );

}




// ========================================
// Settings open / close
// ========================================


if (settingsButton && settingsPanel) {

    settingsButton.addEventListener(
        "click",
        ()=>{

            if(
                settingsPanel.style.display === "block"
            ){

                settingsPanel.style.display =
                    "none";

            }
            else{

                settingsPanel.style.display =
                    "block";

            }

        }
    );

}




// ========================================
// Load settings
// ========================================


async function loadSettings() {


    const data =
        await chrome.storage.local.get([

            "subscription",

            "autoReconnect",

            "interval"

        ]);



    if(subscriptionInput){

        subscriptionInput.value =
            data.subscription || "";

    }



    if(autoReconnectInput){

        autoReconnectInput.checked =
            data.autoReconnect ?? true;

    }



    if(intervalInput){

        intervalInput.value =
            data.interval ?? 30;

    }


}





// ========================================
// Save settings
// ========================================


if (saveSettingsButton) {


    saveSettingsButton.addEventListener(
        "click",
        async () => {


            const subscription =
                subscriptionInput.value.trim();



            await chrome.storage.local.set({

                subscription:

                    subscription,


                autoReconnect:
                    autoReconnectInput.checked,


                interval:
                    Number(intervalInput.value)

            });



            // ارسال Subscription به Backend

            if(subscription){

                await fetch(
                    `${API}/api/subscription`,
                    {
                        method:"POST",

                        headers:{
                            "Content-Type":
                                "application/json"
                        },

                        body:JSON.stringify({
                            url: subscription
                        })
                    }
                );

            }



            if(settingsStatus){

                settingsStatus.textContent =
                    "Saved ✓";


                setTimeout(()=>{

                    settingsStatus.textContent =
                        "";

                },1500);

            }


        }
    );


}
// ========================================
// Initialize
// ========================================

(async function initialize() {

    await loadSettings();

    // 1. Restore connection state.
    await loadState();

    try {

        const response =
            await fetch(
                `${API}/api/status`
            );

        const vpn =
            await response.json();


        setConnectedUI(
            vpn.connected
        );


    }
    catch(e){

        console.log(
            "Status sync failed"
        );

    }

    await syncVPNStatus();

    // 2. Show cache immediately.
    const hasCache =
        await showCachedServers();

    // 3. Refresh in background only
    //    when cache is missing or old.
    const cached =
        await loadProfilesCache();


    if (
        !hasCache ||
        !cached ||
        !cached.fresh
    ) {

        await loadServers(
            false
        );
    }

})();

async function syncVPNStatus(){

    try{

        const response =
            await fetch(
                `${API}/api/status`
            );


        const data =
            await response.json();


        if(!data.running){

            await chrome.storage.local.set({
                connected:false
            });


            updateVPNStatus(
                false,
                null
            );

            return;
        }


        updateVPNStatus(
            true,
            data.latency
        );


    }
    catch(error){

        console.log(
            "Status sync failed",
            error
        );

    }

}


