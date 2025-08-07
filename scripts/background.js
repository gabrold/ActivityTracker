// background.js

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// Configuration management
let config = null;

async function loadConfig() {
    if (config) return config; // Return cached config
    
    try {
        const response = await fetch(chrome.runtime.getURL('config.json'));
        if (!response.ok) {
            throw new Error(`Failed to load config: ${response.status}`);
        }
        config = await response.json();
        console.log(`[${new Date().toLocaleTimeString()}] Background: Config loaded:`, config);
        return config;
    } catch (error) {
        console.error('Error loading config, using defaults:', error);
        // Fallback to default values
        config = {
            spreadsheetId: '1SdRqelVjMs8rpb48Tdn9ZK4Xc05u98D1_lSLdEmfgnA',
            syncIntervalMinutes: 15,
            scopes: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email',
            syncAlarmName: 'activityTrackerSync',
            caching: { durationDays: 30, syncHistoryRetentionDays: 7 },
            heartbeat: { intervalSeconds: 25 },
            sheets: { configRange: 'CONFIG!A:C', teamsRange: 'CONFIG!A:A', logsRange: 'Logs!A:D' }
        };
        return config;
    }
}

// Enhanced alarm restoration system
async function restoreAlarmsFromStorage() {
    try {
        const cfg = await loadConfig();
        
        // Check if user is logged in and has a team selected
        const result = await chrome.storage.sync.get(['loggedInUserEmail', 'userTeam']);
        loggedInUserEmail = result.loggedInUserEmail || null;
        userTeam = result.userTeam || null;
        
        if (loggedInUserEmail && userTeam) {
            console.log(`[${new Date().toLocaleTimeString()}] Background: Restoring alarms for user: ${loggedInUserEmail}, team: ${userTeam}`);
            
            // Check if alarm already exists
            const existingAlarm = await chrome.alarms.get(cfg.syncAlarmName);
            if (!existingAlarm) {
                // Create the alarm if it doesn't exist
                chrome.alarms.create(cfg.syncAlarmName, {
                    periodInMinutes: cfg.syncIntervalMinutes,
                    delayInMinutes: cfg.syncIntervalMinutes
                });
                console.log(`[${new Date().toLocaleTimeString()}] Background: Restored sync alarm for logged-in user`);
            } else {
                console.log(`[${new Date().toLocaleTimeString()}] Background: Sync alarm already exists, no restoration needed`);
            }
        } else {
            console.log(`[${new Date().toLocaleTimeString()}] Background: No logged-in user or team, clearing any existing alarms`);
            chrome.alarms.clear(cfg.syncAlarmName);
        }
    } catch (error) {
        console.error('Error restoring alarms:', error);
    }
}

// Service Worker lifecycle events
chrome.runtime.onStartup.addListener(() => {
    console.log(`[${new Date().toLocaleTimeString()}] Background: Browser startup detected, restoring alarms`);
    restoreAlarmsFromStorage();
});

// Global variables
let loggedInUserEmail = null; // Stored user email
let userTeam = null; // Stored user's selected team

// Restore login info from storage on background script startup
chrome.storage.sync.get(['loggedInUserEmail', 'userTeam'], (obj) => {
    loggedInUserEmail = obj.loggedInUserEmail || null;
    userTeam = obj.userTeam || null;
});

// Utility functions
async function getAuthToken(interactive = false) {
    return new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive }, (token) => {
            if (chrome.runtime.lastError || !token) {
                reject(new Error(chrome.runtime.lastError?.message || "Failed to get auth token"));
            } else {
                resolve(token);
            }
        });
    });
}

async function removeAuthToken() {
    return new Promise(async (resolve, reject) => {
        try {
            const token = await getAuthToken(false);
            if (!token) {
                resolve();
                return;
            }
            // Revoke token from Google
            fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`)
                .catch(() => {}); // Ignore errors
                
            chrome.identity.removeCachedAuthToken({ token }, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve();
                }
            });
        } catch (e) {
            reject(e);
        }
    });
}

async function getUserEmailFromAuth() {
    return new Promise(async (resolve, reject) => {
        try {
            const token = await getAuthToken(false);
            if (!token) {
                reject(new Error("No auth token"));
                return;
            }
            const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (!response.ok) {
                throw new Error(`Failed to fetch user info: ${response.status} ${response.statusText}`);
            }
            const userInfo = await response.json();
            resolve(userInfo.email);
        } catch (e) {
            reject(e);
        }
    });
}

async function sheetsApiAppend(range, values) {
    const cfg = await loadConfig();
    const token = await getAuthToken(false);
    if (!token) throw new Error('No auth token for Sheets API');

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${cfg.spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;

    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            values: values,
        }),
    });
    if (!resp.ok) {
        throw new Error(`Sheets API append error: ${resp.status} ${resp.statusText} - ${await resp.text()}`);
    }
    const data = await resp.json();
    console.log("Sheets API Append Response:", data);
    return data;
}

function getTodayDateKey() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Function to send data to Google Sheets
async function syncActivityDataToSheets() {
    console.log(`[${new Date().toLocaleTimeString()}] Attempting to sync data to sheets...`);
    if (!loggedInUserEmail) {
        console.warn('Not logged in. Skipping sync.');
        return [];
    }
    if (!userTeam) {
        console.warn('No team selected. Skipping sync.');
        return [];
    }

    const cfg = await loadConfig();
    const todayDateKey = getTodayDateKey();
    const activityStorageKey = `activityData_${loggedInUserEmail}_${todayDateKey}`;

    try {
        const result = await chrome.storage.local.get(activityStorageKey);
        const storedActivityData = result[activityStorageKey];

        if (!storedActivityData || !storedActivityData.activities || Object.keys(storedActivityData.activities).length === 0) {
            console.log(`[${new Date().toLocaleTimeString()}] No activity data to sync for today: ${todayDateKey}`);
            return []; // No data to sync
        }

        let hasNonZeroActivities = false;
        for (const activityId in storedActivityData.activities) {
            if (storedActivityData.activities[activityId].count > 0) {
                hasNonZeroActivities = true;
                break;
            }
        }

        if (!hasNonZeroActivities) {
            console.log(`[${new Date().toLocaleTimeString()}] All activities are zero. Skipping sync.`);
            return [];
        }
        console.log(`[${new Date().toLocaleTimeString()}] All stored data:`, storedActivityData);
        console.log(`[${new Date().toLocaleTimeString()}] Checking key ${activityStorageKey}: hasNonZeroActivities = ${hasNonZeroActivities}`);


        const timestamp = new Date().toISOString();
        const rowsToAppend = [];
        const activitiesSyncedForUI = []; // To send back to sidepanel for running totals

        for (const activityId in storedActivityData.activities) {
            const activity = storedActivityData.activities[activityId];
            if (activity.count > 0) {
                rowsToAppend.push([
                    timestamp,
                    loggedInUserEmail,
                    activity.name, // Use the name from stored data
                    activity.count
                ]);
                activitiesSyncedForUI.push({ id: activityId, count: activity.count });
            }
        }
        console.log(`[${new Date().toLocaleTimeString()}] totalRowsToAppend:`, rowsToAppend);
        console.log(`[${new Date().toLocaleTimeString()}] activitiesSyncedForUI:`, activitiesSyncedForUI);


        if (rowsToAppend.length > 0) {
            // Use config for sheet range
            await sheetsApiAppend(cfg.sheets.logsRange, rowsToAppend);
            console.log(`[${new Date().toLocaleTimeString()}] Data successfully appended to Sheets.`);

            // Clear the activity data for today after successful sync
            // Set counts to 0, but keep the structure to avoid re-fetching activities on UI load
            const clearedActivities = {};
            for (const activityId in storedActivityData.activities) {
                clearedActivities[activityId] = {
                    ...storedActivityData.activities[activityId],
                    count: 0
                };
            }
            await chrome.storage.local.set({ [activityStorageKey]: { activities: clearedActivities, team: userTeam } });
            console.log(`[${new Date().toLocaleTimeString()}] Local activity data cleared for today.`);
            return activitiesSyncedForUI; // Return the activities that were actually synced
        } else {
            console.log(`[${new Date().toLocaleTimeString()}] No new non-zero activity counts to append.`);
            return [];
        }

    } catch (error) {
        console.error(`[${new Date().toLocaleTimeString()}] Error syncing data to sheets:`, error);
        // Inform sidepanel about error
        chrome.runtime.sendMessage({ action: 'updateSyncStatus', error: error.message }).catch(e => console.warn("Could not send error message to sidepanel:", e));
        return [];
    }
}

// Alarm listener for periodic sync
chrome.alarms.onAlarm.addListener(async (alarm) => {
    const cfg = await loadConfig();
    
    if (alarm.name === cfg.syncAlarmName) {
        console.log(`[${new Date().toLocaleTimeString()}] Sync alarm triggered!`);
        
        // Start heartbeat during sync process to keep service worker alive
        startHeartbeat();
        
        try {
            // Verify we still have user credentials before syncing
            if (!loggedInUserEmail || !userTeam) {
                console.log(`[${new Date().toLocaleTimeString()}] Background: No user/team info during alarm. Attempting to restore from storage...`);
                await restoreAlarmsFromStorage();
                
                if (!loggedInUserEmail || !userTeam) {
                    console.log(`[${new Date().toLocaleTimeString()}] Background: Still no user/team info after restore. Clearing alarm.`);
                    chrome.alarms.clear(cfg.syncAlarmName);
                    stopHeartbeat();
                    return;
                }
            }
            
            // Inform sidepanel that sync is in progress
            chrome.runtime.sendMessage({ action: 'updateSyncStatus', statusMessage: 'Uploading data to Sheets...' }).catch(e => console.warn("Could not send sync status message to sidepanel:", e));

            const syncedActivities = await syncActivityDataToSheets(); // Capture the returned value
            console.log(`[${new Date().toLocaleTimeString()}] syncActivityDataToSheets finished. Synced activities:`, syncedActivities);

            const syncProcessFinishTime = Date.now();
            await chrome.storage.local.set({ lastSyncTimestamp: syncProcessFinishTime });
            console.log(`[${new Date().toLocaleTimeString()}] Background: Stored last sync timestamp: ${new Date(syncProcessFinishTime).toLocaleString()}`);
            

            // NEW: Generate a unique key for storing synced activities
            const tempSyncedActivitiesKey = `tempSyncedActivities_${loggedInUserEmail || 'unknown'}_${Date.now()}`;
            await chrome.storage.local.set({ [tempSyncedActivitiesKey]: syncedActivities });
            console.log(`[${new Date().toLocaleTimeString()}] Stored synced activities in local storage under key: ${tempSyncedActivitiesKey}`);
            console.log('Saving to temp key:', tempSyncedActivitiesKey, syncedActivities);

            // Send message to sidepanel to update UI, totals, and clear inputs
            // Pass the storage key instead of the full array
            chrome.runtime.sendMessage({
                action: 'syncCompleteAndClearUI',
                lastSyncTimestamp: syncProcessFinishTime, // Use the time AFTER sync completes
                nextSyncInSeconds: cfg.syncIntervalMinutes * 60,
                tempSyncedActivitiesKey: tempSyncedActivitiesKey // Pass the key
            }).then(() => {
                console.log(`[${new Date().toLocaleTimeString()}] Sent syncCompleteAndClearUI message to sidepanel with storage key.`);
            }).catch(e => console.warn("Could not send sync complete message to sidepanel:", e));

            // After sync, ensure the alarm is correctly scheduled for the *next* interval
            chrome.alarms.clear(cfg.syncAlarmName, (wasCleared) => {
                if (wasCleared) {
                    console.log("Cleared old alarm.");
                }
                chrome.alarms.create(cfg.syncAlarmName, {
                    periodInMinutes: cfg.syncIntervalMinutes,
                    delayInMinutes: cfg.syncIntervalMinutes
                });
                console.log("Re-created alarm for next interval.");
            });
            
        } catch (error) {
            console.error(`[${new Date().toLocaleTimeString()}] Error during sync alarm:`, error);
            // Still recreate the alarm even if sync failed
            chrome.alarms.clear(cfg.syncAlarmName, (wasCleared) => {
                chrome.alarms.create(cfg.syncAlarmName, {
                    periodInMinutes: cfg.syncIntervalMinutes,
                    delayInMinutes: cfg.syncIntervalMinutes
                });
                console.log("Re-created alarm after sync error.");
            });
        } finally {
            // Stop heartbeat after sync is complete
            setTimeout(() => stopHeartbeat(), 5000); // Give it 5 seconds before stopping heartbeat
        }
    }
});

// Listener for messages from the sidepanel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
        case "login":
            (async () => {
                try {
                    startHeartbeat(); // Start heartbeat during login process
                    const token = await getAuthToken(true); // Interactive login
                    loggedInUserEmail = await getUserEmailFromAuth();
                    await chrome.storage.sync.set({ loggedInUserEmail });
                    sendResponse({ success: true, email: loggedInUserEmail });
                    
                    // Don't stop heartbeat immediately - let it continue for active users
                    console.log(`[${new Date().toLocaleTimeString()}] Background: User logged in: ${loggedInUserEmail}`);

                } catch (error) {
                    console.error("Login failed:", error);
                    stopHeartbeat(); // Stop heartbeat on login failure
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true; // Important: for async sendResponse

        case "logout":
            (async () => {
                try {
                    await removeAuthToken();
                    loggedInUserEmail = null;
                    userTeam = null; // Clear team on logout
                    await chrome.storage.sync.remove(['loggedInUserEmail', 'userTeam']); // Clear stored user data
                    chrome.alarms.clear(SYNC_ALARM_NAME); // Clear sync alarm on logout
                    stopHeartbeat(); // Stop heartbeat on logout
                    console.log("Logged out, token removed, alarm cleared, and heartbeat stopped.");
                    sendResponse({ success: true });
                } catch (error) {
                    console.error("Logout failed:", error);
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true; // Important: for async sendResponse

        case "teamSelected":
            (async () => {
                try {
                    userTeam = request.team;
                    await chrome.storage.sync.set({ userTeam });
                    sendResponse({ success: true });
                    console.log(`Team selected and stored: ${userTeam}`);
                    
                    // Ensure alarms are properly set up after team selection
                    await restoreAlarmsFromStorage();
                } catch (error) {
                    console.error("Failed to set team:", error);
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true; // Important: for async sendResponse

        case "startSyncAlarm":
            (async () => {
                const cfg = await loadConfig();
                chrome.alarms.clear(cfg.syncAlarmName, () => {
                    chrome.alarms.create(cfg.syncAlarmName, {
                        periodInMinutes: cfg.syncIntervalMinutes,
                        delayInMinutes: cfg.syncIntervalMinutes
                    });
                    console.log("Initial sync alarm created after activities loaded.");
                    startHeartbeat(); // Start heartbeat when sync alarm is active
                    sendResponse({ success: true });
                });
            })();
            return true; // For async sendResponse

        case "updateLocalActivityData":
            (async () => {
                const { userEmail, todayDateKey, activityId, data } = request;
                const storageKey = `activityData_${userEmail}_${todayDateKey}`;

                try {
                    // Fetch existing data for the day
                    const result = await chrome.storage.local.get(storageKey);
                    const existingData = result[storageKey] || { activities: {}, team: userTeam };

                    // Update the specific activity count
                    existingData.activities[activityId] = {
                        count: data.activities[activityId].count,
                        name: data.activities[activityId].name // Store name too
                    };

                    // Save updated data back
                    await chrome.storage.local.set({ [storageKey]: existingData });
                    console.log(`[${new Date().toLocaleTimeString()}] Background: Saved local activity data for ${activityId}:`, existingData.activities[activityId]);
                    sendResponse({ success: true });
                } catch (error) {
                    console.error("Error updating local activity data:", error);
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true; // Important: for async sendResponse

        case "requestNextSyncTime":
            (async () => {
                try {
                    if (!loggedInUserEmail) {
                        sendResponse({ success: false, error: "Not logged in" });
                        return;
                    }
                    const cfg = await loadConfig();
                    const alarm = await chrome.alarms.get(cfg.syncAlarmName);
                    let nextSyncInSeconds;
                    let lastSyncTimestamp;
                    const syncObj = await chrome.storage.local.get('lastSyncTimestamp');
                    lastSyncTimestamp = syncObj.lastSyncTimestamp || null;
                    if (alarm) {
                        const now = Date.now();
                        nextSyncInSeconds = Math.max(0, Math.floor((alarm.scheduledTime - now) / 1000));
                    }
                    sendResponse({ success: true, lastSyncTimestamp, nextSyncInSeconds });
                } catch (error) {
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true; // Important: for async sendResponse

        case "runningTotalsUpdated":
            // Running totals have been updated in storage (by sidepanel)
            // No direct action needed in background, this is just a confirmation message.
            sendResponse({ success: true });
            break;

        case "sidepanelReadyForSyncedActivitiesClear": // NEW action from sidepanel
            (async () => {
                const { keyToClear } = request;
                if (keyToClear) {
                    await chrome.storage.local.remove(keyToClear);
                    console.log(`[${new Date().toLocaleTimeString()}] Background: Cleared temporary synced activities data from storage: ${keyToClear}`);
                    sendResponse({ success: true });
                } else {
                    sendResponse({ success: false, error: "No key provided to clear." });
                }
            })();
            return true; // Important for async sendResponse

        case "syncCompleteAndClearUI":
            // This action is sent from background to sidepanel, so background does nothing with it.
            // But we must acknowledge receipt for the sidepanel to continue.
            sendResponse({ success: true });
            break;

         case "updateSyncStatus":
            // This action is sent from background to sidepanel, so background does nothing with it.
            sendResponse({ success: true });
            break;
    }
    return true; // Important for async responses in message listener
});

// (Optional) For debugging sheets API port messages
chrome.runtime.onConnect.addListener(function(port) {
    if (port.name === "sheetsApi") {
        port.onMessage.addListener(function(msg) {
            console.log("Message from Sheets API port:", msg);
        });
    }
});
