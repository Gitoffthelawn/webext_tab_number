/* globals defaultOptions, getOptions, onError */
"use strict";

function restoreOptions(opt) {
    switch (opt.scope) {
    case "window":
        document.getElementById("scope_window").checked = true;
        break;
    case "global":
        document.getElementById("scope_global").checked = true;
        break;
    default:
        onError("invalid scope");
    }

    switch (opt.displayMode) {
    case "icon":
        document.getElementById("dm_icon").checked = true;
        break;
    case "badge":
        document.getElementById("dm_badge").checked = true;
        break;
    default:
        onError("invalid displayMode");
    }

    document.getElementById("badgeBg").value = opt.badgeBg;

    document.getElementById("iconDimension").value = opt.iconDimension;

    document.getElementById("iconFont").value = opt.iconFont;

    document.getElementById("iconColor").value = opt.iconColor;

    document.getElementById("iconFontMultiplier").value = opt.iconFontMultiplier;

    ["dm_icon", "dm_badge"].forEach(i => {
        document.getElementById(i).addEventListener("change", updateDisabled);
    });
    updateDisabled();
}

function restoreSavedOptions() {
    getOptions().then(restoreOptions);
}

function updateDisabled() {
    const dm_icon = document.getElementById("dm_icon").checked;
    const dm_badge = document.getElementById("dm_badge").checked;

    document.getElementById("badgeBg").disabled = !dm_badge;

    document.getElementById("iconDimension").disabled = !dm_icon;
    document.getElementById("iconFont").disabled = !dm_icon;
    document.getElementById("iconColor").disabled = !dm_icon;
    document.getElementById("iconFontMultiplier").disabled = !dm_icon;
}

function saveOptions(e) {
    e.preventDefault();
    let scope;
    if (document.getElementById("scope_window").checked) {
        scope = "window";
    } else if (document.getElementById("scope_global").checked) {
        scope = "global";
    } else {
        onError("no scope selected");
        return;
    }

    let displayMode;
    if (document.getElementById("dm_icon").checked) {
        displayMode = "icon";
    } else if (document.getElementById("dm_badge").checked) {
        displayMode = "badge";
    } else {
        onError("no displayMode selected");
        return;
    }

    const entered = {
        "scope": scope,
        "displayMode": displayMode,
        "badgeBg": document.getElementById("badgeBg").value,
        "iconDimension": parseInt(document.getElementById("iconDimension").value, 10),
        "iconFont": document.getElementById("iconFont").value,
        "iconColor": document.getElementById("iconColor").value,
        "iconFontMultiplier": parseFloat(document.getElementById("iconFontMultiplier").value),
    };

    let changed = Object();
    for (let i in entered) {
        if (entered[i] === defaultOptions[i]) {
            browser.storage.local.remove(i);
        } else {
            changed[i] = entered[i];
        }
    }
    browser.storage.local.set(changed);

    browser.runtime.reload();
}

document.addEventListener("DOMContentLoaded", restoreSavedOptions);
document.querySelector("form").addEventListener("submit", saveOptions);
