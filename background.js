/* globals getOptions, onError, supportsWindowId, supportsTabReset, migrate */
"use strict";
async function main() {
    /* eslint no-restricted-properties: ["error", {
        "property": "addListener",
    }] */
    await migrate();
    const options = await getOptions();
    const useWindowId = await supportsWindowId();
    const doTabReset = await supportsTabReset();

    let setText;
    let fontcfg;

    /* On some versions of Firefox the tab list returned by browser.tabs.query
     * still contains some closed tabs in the resulting browser.tabs.onRemoved
     * and browser.tabs.onActivated events
     * when closing multiple tabs at once (e.g. by ctrl-selecting them) this
     * may even result in the count being off by more than one
     */
    let filterTabs = [];
    async function tabsQueryFilter(queryInfo) {
        const tabs = await browser.tabs.query(queryInfo);
        return tabs.filter(i => !filterTabs.includes(i.id));
    }

    let listeners = [];
    function addListener(event, listener) {
        listeners.push({
            event: event,
            listener: listener,
        });
        // eslint-disable-next-line no-restricted-properties
        event.addListener(listener);
    }

    function removeListeners() {
        for (let i of listeners) {
            i.event.removeListener(i.listener);
        }
    }

    addListener(browser.storage.onChanged, async () => {
        if (doTabReset) {
            await resetBadgeIconAll();
        }
        removeListeners();
        main();
    });

    async function resetBadgeIconAll() {
        resetBadgeIcon(null);
        if (options.scope === "global") return;
        if (useWindowId) {
            const tabs = await browser.tabs.query({active: true});
            await Promise.all(tabs.map(i => resetBadgeIcon({windowId: i.windowId})));
        } else {
            const tabs = await browser.tabs.query({});
            await Promise.all(tabs.map(i => resetBadgeIcon({tabId: i.id})));
        }
    }

    async function resetBadgeIcon(spec) {
        if (options.displayMode === "badge") {
            await browser.browserAction.setBadgeText(
                Object.assign({text: null}, spec)
            );
        } else if (options.displayMode === "icon") {
            await browser.browserAction.setIcon(
                Object.assign({imageData: null}, spec)
            );
        } else {
            onError("invalid displayMode");
            return;
        }
    }

    async function updateGlobal() {
        const tabs = await tabsQueryFilter({windowType: "normal"});
        await setText(null, [tabs.length.toString()]);
    }

    async function updateWindows() {
        const tabs = await tabsQueryFilter({active: true});
        await Promise.all(tabs.map(i => updateWindow(i.windowId)));
    }

    async function updateWindow(windowId) {
        const tabs = await tabsQueryFilter({windowId: windowId});
        await setText({windowId: windowId}, [tabs.length.toString()]);
    }

    async function updateActive(windowId) {
        const tabs = await tabsQueryFilter({windowId: windowId});
        const active = tabs.filter(i => i.active)[0];
        await setText({tabId: active.id}, [tabs.length.toString()]);
    }

    async function updateActives() {
        const tabs = await tabsQueryFilter({active: true});
        await Promise.all(tabs.map(i => updateTab(i.id, i.windowId)));
    }

    async function updateTab(tabId, windowId) {
        const tabs = await tabsQueryFilter({windowId: windowId});
        await setText({tabId: tabId}, [tabs.length.toString()]);
    }

    async function updateBoth() {
        const tabs = await tabsQueryFilter({});
        const total = tabs.length;
        let counts = new Map();
        for (let i of tabs) {
            if (counts.has(i.windowId)) {
                counts.set(i.windowId, counts.get(i.windowId) + 1);
            } else {
                counts.set(i.windowId, 1);
            }
        }
        if (counts.size === 1) {
            await setText({windowId: tabs[0].windowId}, [total.toString()]);
            return;
        }
        for (let [i, n] of counts) {
            await setText({windowId: i}, [n.toString(), total.toString()]);
        }
    }

    async function updateBothTab() {
        const tabs = await tabsQueryFilter({});
        const total = tabs.length;
        let counts = new Map();
        let actives = new Map();
        for (let i of tabs) {
            if (counts.has(i.windowId)) {
                counts.set(i.windowId, counts.get(i.windowId) + 1);
            } else {
                counts.set(i.windowId, 1);
            }
            if (i.active) {
                actives.set(i.windowId, i.id);
            }
        }
        if (counts.size === 1) {
            const active = actives.values().next().value;
            await setText({tabId: active}, [total.toString()]);
            return;
        }
        for (let [i, active] of actives) {
            const n = counts.get(i);
            await setText({tabId: active}, [n.toString(), total.toString()]);
        }
    }

    async function setTextBadge(spec, text) {
        await browser.browserAction.setBadgeText(Object.assign({text: text[0]}, spec));
    }


    async function setTextIcon(spec, text) {
        const data = drawTextCanvas(
            text,
            options.iconDimension,
            options.iconDimension,
            options.iconMargin / 100,
            options.iconColor,
            fontcfg
        );
        await browser.browserAction.setIcon(Object.assign({imageData: data}, spec));
    }

    if (options.displayMode === "badge") {
        setText = setTextBadge;
        await browser.browserAction.setBadgeBackgroundColor({color:options.badgeBg});
    } else if (options.displayMode === "icon") {
        setText = setTextIcon;
        /* completely transparent image looks better than the default icon flashing
         * for < 1s when switching to previously unset tab
         */
        await browser.browserAction.setIcon({
            imageData: new ImageData(options.iconDimension, options.iconDimension),
        });

        fontcfg = getFontcfg(options.iconFont, options.iconDimension, "0123456789", 1);
    } else {
        onError("invalid displayMode");
        return;
    }

    if (options.scope === "window") {
        if (useWindowId) {
            addListener(browser.tabs.onRemoved, (tabId, removeInfo) => {
                filterTabs.push(tabId);
                updateWindow(removeInfo.windowId);
            });
            addListener(browser.tabs.onDetached, (_, detachInfo) =>
                updateWindow(detachInfo.oldWindowId)
            );
            addListener(browser.tabs.onCreated, tab => {
                filterTabs = [];
                updateWindow(tab.windowId);
            });
            addListener(browser.tabs.onAttached, (_, attachInfo) =>
                updateWindow(attachInfo.newWindowId)
            );

            updateWindows();
        } else {
            addListener(browser.tabs.onActivated, activeInfo =>
                updateTab(activeInfo.tabId, activeInfo.windowId)
            );
            addListener(browser.tabs.onDetached, (_, detachInfo) =>
                updateActive(detachInfo.oldWindowId)
            );
            addListener(browser.tabs.onAttached, (_, attachInfo) =>
                updateActive(attachInfo.newWindowId)
            );
            addListener(browser.tabs.onCreated, tab => {
                filterTabs = [];
                updateTab(tab.id, tab.windowId);
            });
            addListener(browser.tabs.onRemoved, (tabId, removeInfo) => {
                filterTabs.push(tabId);
                updateActive(removeInfo.windowId);
            });
            addListener(browser.tabs.onUpdated, (tabId, changeInfo, tab) => {
                if ("url" in changeInfo && tab.active) {
                    updateTab(tabId, tab.windowId);
                }
            });

            updateActives();
        }
    } else if (options.scope === "both") {
        if (useWindowId) {
            addListener(browser.tabs.onDetached, updateBoth);
            addListener(browser.tabs.onAttached, updateBoth);
            addListener(browser.tabs.onCreated, () => {
                filterTabs = [];
                updateBoth();
            });
            addListener(browser.tabs.onRemoved, tabId => {
                filterTabs.push(tabId);
                updateBoth();
            });

            updateBoth();
        } else {
            addListener(browser.tabs.onActivated, updateBothTab);
            addListener(browser.tabs.onDetached, updateBothTab);
            addListener(browser.tabs.onAttached, updateBothTab);
            addListener(browser.tabs.onCreated, () => {
                filterTabs = [];
                updateBothTab();
            });
            addListener(browser.tabs.onRemoved, tabId => {
                filterTabs.push(tabId);
                updateBothTab();
            });
            addListener(browser.tabs.onUpdated, (tabId, changeInfo, tab) => {
                if ("url" in changeInfo && tab.active) {
                    updateBothTab();
                }
            });

            updateBothTab();
        }
    } else if (options.scope === "global") {
        addListener(browser.tabs.onRemoved, tabId => {
            filterTabs.push(tabId);
            updateGlobal();
        });
        addListener(browser.tabs.onCreated, () => {
            filterTabs = [];
            updateGlobal();
        });

        updateGlobal();
    } else {
        onError("invalid scope");
        return;
    }
}

main();

/* draw centered text to canvas and return image data
 */
function drawTextCanvas(
    text, width, height, margin, color, fontcfg
) {
    const marginCount = 1 + text.length; // one at the beginning and one after every line
    const totalMargins = marginCount * margin;
    const lineFrac = (1 - totalMargins) / text.length;
    const fontSize = height * lineFrac * fontcfg.adjustedFontSize;
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d");

    ctx.font = `${fontSize}px ${fontcfg.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = color;
    text.forEach((str, i) => {
        const bottom = i * lineFrac + (i + 1) * margin + fontcfg.adjustedBottom * lineFrac;
        ctx.fillText(
            str,
            width / 2,
            bottom * height,
            width
        );
    });
    const data = ctx.getImageData(
        0, 0, width, height
    );
    return data;
}


/* find fraction of height from top, such that text touches bottom of canvas
 * textBaseline = "ideographic" doesn't do the right thing
 * assuming real bottom is underneath alphabetic baseline
 */
function getAdjustedBottom(font, str, height, step) {
    const canvas = document.createElement("canvas");
    canvas.height = height;
    const width = height * str.length * 2;
    canvas.width = width;
    const ctx = canvas.getContext("2d");
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";

    ctx.font = `${height}pt ${font}`;

    let bottom = height;
    for (let i = bottom; i > 0; i -= step) {
        ctx.fillText(str, width / 2, i, width);

        // every pixel in bottom row is blank
        if (ctx.getImageData(0, height - 1, width, 1).data.every(p => !p)) {
            return bottom / height;
        }
        bottom = i;
        ctx.clearRect(0, 0, width, height);
    }
}

/* find fraction of height to use for font size in px, such that the text
 * touches top of canvas
 */
function getAdjustedFontSize(font, str, height, step, adjBottom) {
    const bottom = adjBottom * height;
    const canvas = document.createElement("canvas");
    canvas.height = height;
    const width = height * str.length * 2;
    canvas.width = width;
    const ctx = canvas.getContext("2d");
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";

    const max = height * 2;
    for (let fontSize = 1; fontSize < max; fontSize += step) {
        ctx.font = `${fontSize}px ${font}`;
        ctx.fillText(str, width / 2, bottom, width);

        // at least one pixel in top row is not blank
        if (ctx.getImageData(0, 0, width, 1).data.some(p => p)) {
            return fontSize / height;
        }
        ctx.clearRect(0, 0, width, height);
    }
}

function getFontcfg(font, height, str, step) {
    const adjustedBottom = getAdjustedBottom(font, str, height, step);
    const adjustedFontSize = getAdjustedFontSize(font, str, height, step, adjustedBottom);
    return {
        font: font,
        adjustedBottom: adjustedBottom,
        adjustedFontSize: adjustedFontSize,
    };
}