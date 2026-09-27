console.log("VPN background loaded");

let reconnecting = false;


const API =
"http://127.0.0.1:8765";

// ==============================
// Alarm
// ==============================
function createVPNAlarm(){

    chrome.alarms.create(
        "vpnMonitor",
        {
            periodInMinutes: 0.5
        }
    );

}


chrome.runtime.onInstalled.addListener(()=>{
    createVPNAlarm();
});


chrome.runtime.onStartup.addListener(()=>{
    createVPNAlarm();
});


// ==============================
// Proxy helpers
// ==============================
function setProxy(){

    chrome.proxy.settings.set(
        {
            value:{
                mode:"fixed_servers",

                rules:{
                    singleProxy:{
                        scheme:"http",
                        host:"127.0.0.1",
                        port:2080
                    },
                    bypassList:[
                        "localhost",
                        "127.0.0.1"
                    ]
                }
            },

            scope:"regular"

        },

        () => {

            if (chrome.runtime.lastError) {
                console.log(
                    "Proxy error:",
                    chrome.runtime.lastError.name
                );
                return;
            }

            console.log(
                "PROXY RESULT: SUCCESS"
            );

        }
    );

}



function clearProxy(){

    chrome.proxy.settings.clear(
        {
            scope:"regular"
        }
    );

}


chrome.alarms.onAlarm.addListener(
    async(alarm)=>{

        if(
            alarm.name==="vpnMonitor"
        ){

            await checkVPN();

        }

    }
);



// ==============================
// Monitor
// ==============================

async function checkVPN(){

    try{

        const response =
            await fetch(
                `${API}/api/status`
            );


        const data =
            await response.json();


        console.log(
            "VPN STATUS",
            data
        );


        await chrome.storage.local.set({

            connected:
                data.connected,

            latency:
                data.latency

        });


        const state =
            await chrome.storage.local.get([
                "userDisconnected"
            ]);

        console.log(
            "Manual disconnect state:",
            state.userDisconnected
        );    

        if(
            !data.connected &&
            !state.userDisconnected
        ){
            console.log(
            "Manual disconnect state:",
            state.userDisconnected
        );

            await autoReconnect();

        }

    }
    catch(error){

        console.log(
            "Monitor error:",
            error.name
        );

    }

}


// ==============================
// Auto reconnect
// ==============================

async function autoReconnect(){

    if (reconnecting) {
        console.log("Reconnect already running");
        return;
    }

    reconnecting = true;

    console.log(
        "AUTO RECONNECT CALLED"
     );

    console.log(
        "Trying reconnect..."
    );


    try{

        const response =
            await fetch(
                `${API}/api/auto-reconnect`,
                {
                    method:"POST"
                }
            );
        console.log(
             "AUTO RECONNECT HTTP:",
             response.status
        );

        const data =
            await response.json();

        console.log(
            "AUTO RECONNECT DATA:",
            data
        );    



        if(
            data.connected
        ){

            setProxy();
               
             await chrome.storage.local.set({

                userDisconnected:false,

                connected:true,

                latency:data.latency

            });
            
        }

    }
    catch(error){

        console.log(
            "Reconnect failed:",
            error.name
        );

    }

    finally {

        reconnecting = false;

    }

}



chrome.runtime.onMessage.addListener(
    (
        request,
        sender,
        sendResponse
    )=>{


        if(
            request.action === "setProxy"
        ){

            const proxyConfig = {

                mode:"fixed_servers",

                rules:{

                    singleProxy:{

                        scheme:"http",

                        host:"127.0.0.1",

                        port:2080

                    },

                    bypassList:[

                        "localhost",

                        "127.0.0.1"

                    ]

                }

            };


            chrome.proxy.settings.set(

                {
                    value: proxyConfig,
                    scope:"regular"
                },


                ()=>{


                    if(
                        chrome.runtime.lastError
                    ){

                        console.log(
                            "Proxy error:",
                            chrome.runtime.lastError.message
                        );


                        sendResponse({

                            success:false,

                            error:
                            chrome.runtime.lastError.message


                        });


                    }
                    else{


                        console.log(
                            "Proxy enabled"
                        );


                        sendResponse({

                            success:true

                        });


                    }


                }

            );


            return true;

        }

        if(
            request.action === "clearProxy"
        ){

            chrome.proxy.settings.clear(
                {
                    scope:"regular"
                },

                ()=>{

                    sendResponse({
                        success:true
                    });

                }
            );


            return true;
        }


    }
);
