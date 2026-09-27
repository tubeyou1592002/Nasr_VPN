const subscription =
    document.getElementById(
        "subscription"
    );


const autoReconnect =
    document.getElementById(
        "autoReconnect"
    );


const interval =
    document.getElementById(
        "interval"
    );


const status =
    document.getElementById(
        "status"
    );



// Load saved settings

chrome.storage.local.get(
    [
        "subscription",
        "autoReconnect",
        "interval"
    ],

    (data)=>{


        if(data.subscription){

            subscription.value =
                data.subscription;

        }


        autoReconnect.checked =
            data.autoReconnect ?? true;


        interval.value =
            data.interval ?? 30;


    }

);




// Save

document
.getElementById("save")
.addEventListener(
"click",

async()=>{


    await chrome.storage.local.set({

        subscription:
            subscription.value.trim(),


        autoReconnect:
            autoReconnect.checked,


        interval:
            Number(interval.value)

    });



    status.textContent =
        "Settings saved";


    setTimeout(()=>{

        status.textContent="";

    },2000);


});