// sidepanel.js

// Moved to the top for proper initialization
function updateSyncStatusUI(lastSyncTimestamp, nextSyncInSeconds) {
    console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: updateSyncStatusUI called. Last Sync: ${lastSyncTimestamp}, Next Sync In: ${nextSyncInSeconds}`);
    if (lastSyncTimestamp) {
        const lastSyncDate = new Date(lastSyncTimestamp);
        lastSyncTimeDiv.textContent = `Last Synced: ${lastSyncDate.toLocaleString()}`;
    } else {
        lastSyncTimeDiv.textContent = 'Last Synced: Never / In Progress';
    }

    if (countdownIntervalId) {
        clearInterval(countdownIntervalId);
    }

    // Only start countdown if a valid next sync time is provided
    if (nextSyncInSeconds !== undefined) {
        let remainingSeconds = nextSyncInSeconds;

        const updateCountdownText = () => {
            if (remainingSeconds <= 0) {
                // If countdown reaches 0 or starts at 0, display "Soon..."
                // and stop the interval. A new sync will trigger a fresh update.
                nextSyncCountdownDiv.textContent = 'Next Sync: Soon...';
                clearInterval(countdownIntervalId);
                // IMPORTANT: Do NOT re-request next sync time here.
                // The background script will inform the sidepanel when a sync
                // completes, providing the updated schedule then.
            } else {
                const minutes = Math.floor(remainingSeconds / 60);
                const seconds = remainingSeconds % 60;
                nextSyncCountdownDiv.textContent = `Next Sync: ${minutes}m ${seconds}s`;
                remainingSeconds--;
            }
        };

        // Call immediately to avoid initial delay
        updateCountdownText();
        countdownIntervalId = setInterval(updateCountdownText, 1000);
    } else {
        // If nextSyncInSeconds is undefined, show 'Calculating...'
        nextSyncCountdownDiv.textContent = 'Next Sync: Calculating...';
    }
    console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: updateSyncStatusUI finished.`);
}

// Global variables and constants
const activityCounts = {}; // This now represents the current session's input values
const runningTotals = {}; // Object for cumulative running totals
let currentTeam = null;
let loggedInUserEmail = null;
let activities = [];

// UI elements
const activityListDiv = document.getElementById('activity-list');
const authSection = document.getElementById('auth-section');
const authButton = document.getElementById('auth-button');
const statusMessageDiv = document.getElementById('status-message');
const teamSelectionDiv = document.getElementById('team-selection');
const changeTeamButton = document.getElementById('change-team-button');
const selectedTeamRow = document.getElementById('selected-team-row');
const selectedTeamLabel = document.getElementById('selected-team-label');
const teamSelect = document.getElementById('team-select');
const selectTeamButton = document.getElementById('select-team-button');
const logoutButton = document.getElementById('logout-button');
const lastSyncTimeDiv = document.getElementById('last-sync-time');
const nextSyncCountdownDiv = document.getElementById('next-sync-countdown');
let countdownIntervalId;
let statusMessageTimeoutId;
let statusMessageAlternateIntervalId = null;
let showWaiting = true;

const SPREADSHEET_ID = '1SdRqelVjMs8rpb48Tdn9ZK4Xc05u98D1_lSLdEmfgnA';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/userinfo.email';

// THEME TOGGLE
const changeThemeButton = document.getElementById('change-theme-button');

// Helper to set theme and button text
function setTheme(isLight) {
    if (isLight) {
        document.body.classList.add('light-theme');
        changeThemeButton.textContent = '⁂ Light Mode';
    } else {
        document.body.classList.remove('light-theme');
        changeThemeButton.textContent = '∯ Dark Mode';
    }
}

// Load theme preference on startup
chrome.storage.local.get('theme', (result) => {
    setTheme(result.theme === 'light');
});

// Toggle and persist theme on button click
changeThemeButton.addEventListener('click', () => {
    const isLight = !document.body.classList.contains('light-theme');
    setTheme(isLight);
    chrome.storage.local.set({ theme: isLight ? 'light' : 'dark' });
});

async function sendMessageToBackground(message) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage(message, response => resolve(response));
    });
}

async function getAuthToken(interactive = false) {
    return new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive }, token => {
            if (chrome.runtime.lastError || !token) {
                reject(new Error(chrome.runtime.lastError?.message || "Failed to get auth token"));
            } else {
                resolve(token);
            }
        });
    });
}

async function sheetsApiGet(range) {
    const token = await getAuthToken(false);
    if (!token) throw new Error('No auth token for Sheets API');

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`;

    const resp = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
        },
    });
    if (!resp.ok) {
        throw new Error(`Sheets API error: ${resp.status} ${resp.statusText}`);
    }
    const data = await resp.json();
    return data;
}

function getTodayDateKey() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Show/hide team selection dropdown
changeTeamButton.addEventListener('click', async () => {
    // Show the team selection dropdown
    teamSelectionDiv.style.display = '';
    // Optionally, hide the activity list until a new team is selected
    activityListDiv.style.display = 'none';
    changeTeamButton.style.display = 'none';
    // Optionally, clear the status message
    selectedTeamLabel.textContent = 'Please select your team.';
    // Refresh the team list in case it changed
    await showTeamSelection();
});

// --- Authentication & Initialization ---

async function login() {
    const response = await sendMessageToBackground({ action: 'login' });
    if (response.success) {
        loggedInUserEmail = response.email;
        statusMessageDiv.textContent = `Logged in as: ${loggedInUserEmail}`;
        authSection.style.display = 'none';
        logoutButton.style.display = 'block';
        await showTeamSelection();
    } else {
        throw new Error(response.error || 'Login failed');
    }
}

async function logout() {
    const response = await sendMessageToBackground({ action: 'logout' });
    if (response.success) {
        statusMessageDiv.textContent = 'Logged out.';
        authButton.style.display = 'block';
        authSection.style.display = '';
        logoutButton.style.display = 'none';
        activityListDiv.style.display = 'none';
        teamSelectionDiv.style.display = 'none';
        selectedTeamRow.style.display = 'none'; // <-- Hide selected team row
        teamSelect.innerHTML = ''; // <-- Clear team dropdown
        // Clear all activity and running total counts locally
        for (const key in activityCounts) delete activityCounts[key];
        for (const key in runningTotals) delete runningTotals[key];
        activities = [];
        currentTeam = null;
        loggedInUserEmail = null;
        if (statusMessageAlternateIntervalId) {
            clearInterval(statusMessageAlternateIntervalId);
            statusMessageAlternateIntervalId = null;
        }
        // Remove userTeam from storage
        await chrome.storage.sync.remove('userTeam');
        updateActivityCountsUI(); // Clear UI
        updateSyncStatusUI(null, undefined); // Clear sync status UI on logout
    } else {
        throw new Error(response.error || 'Logout failed');
    }
}

// --- Fetch Teams from Sheets ---

async function fetchTeamsFromSheets() {
    try {
        const data = await sheetsApiGet('CONFIG!A:A');
        if (!data.values || data.values.length === 0) return [];
        const rawTeams = data.values.slice(1).flat().filter(t => t && t.trim() !== '');
        const uniqueTeams = [...new Set(rawTeams)];
        return uniqueTeams;
    } catch (err) {
        console.error('Error fetching teams:', err);
        return [];
    }
}

// --- Fetch Activities for Selected Team from Sheets ---

async function fetchActivitiesForTeam(teamName) {
    try {
        const data = await sheetsApiGet('CONFIG!A:C');
        if (!data.values) return [];
        const teamActivities = data.values.filter(row => row[0] === teamName);
        return teamActivities.map(row => ({
            id: row[1],
            name: row[2] || row[1]
        }));
    } catch (err) {
        console.error('Error fetching activities:', err);
        return [];
    }
}

// Helper to get the storage key for activity order
function getActivityOrderStorageKey() {
    return `activityOrder_${loggedInUserEmail}_${currentTeam}`;
}

// Save the current order to chrome.storage.sync
async function saveActivityOrder() {
    const key = getActivityOrderStorageKey();
    const order = activities.map(a => a.id);
    await chrome.storage.sync.set({ [key]: order });
}

// Load the order from chrome.storage.sync and reorder activities array
async function loadActivityOrder() {
    const key = getActivityOrderStorageKey();
    const obj = await chrome.storage.sync.get(key);
    const order = obj[key];
    if (order && Array.isArray(order)) {
        // Reorder activities array in-place
        activities.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    }
}

// --- UI Handlers ---

authButton.addEventListener('click', async () => {
    try {
        await login();
    } catch (err) {
        console.error('Auth error:', err);
        statusMessageDiv.textContent = 'Login failed.';
    }
});

logoutButton.addEventListener('click', async () => {
    try {
        await logout();
    } catch (err) {
        console.error('Logout error:', err);
        statusMessageDiv.textContent = `Logout failed: ${err.message}`;
    }
});

// Call this after selecting a team:
function showSelectedTeam(teamName) {
    selectedTeamLabel.textContent = `Selected Team: ${teamName}`;
    selectedTeamRow.style.display = 'flex';
    teamSelectionDiv.style.display = 'none';
    changeTeamButton.style.display = ''; // Show the change team button
}

async function showTeamSelection() {
    teamSelectionDiv.style.display = 'block';
    activityListDiv.style.display = 'none';
    changeTeamButton.style.display = 'none'; // Hide the change team button until a team is selected

    try {
        const teams = await fetchTeamsFromSheets();
        if (teams.length === 0) {
            statusMessageDiv.textContent = 'No teams found or error fetching teams.';
            return;
        }

        teamSelect.innerHTML = '<option value="">--Select a Team--</option>';
        teams.forEach(team => {
            const option = document.createElement('option');
            option.value = team;
            option.textContent = team;
            teamSelect.appendChild(option);
        });

        const obj = await chrome.storage.sync.get('userTeam');
        const userTeam = obj.userTeam;
        if (userTeam && teams.includes(userTeam)) {
            teamSelect.value = userTeam;
        }
    } catch (error) {
        console.error('Error fetching teams:', error);
        statusMessageDiv.textContent = 'Error fetching teams. Please try again.';
    }
}

selectTeamButton.addEventListener('click', async () => {
    const selectedTeam = teamSelect.value;
    if (!selectedTeam) {
        statusMessageDiv.textContent = 'No team selected yet. Please choose a team.';
        return;
    }

    try {
        const response = await sendMessageToBackground({ action: 'teamSelected', team: selectedTeam });
        if (response.success) {
            currentTeam = selectedTeam;
            showSelectedTeam(selectedTeam); // <-- This handles showing the selected team row and hiding the selection
            activityListDiv.style.display = 'block';
            await loadInitialCountsAndActivities(selectedTeam);

            // NEW: Start the sync alarm/countdown after activities are loaded
            await sendMessageToBackground({ action: 'startSyncAlarm' });
            // Immediately request the next sync time to update the countdown
            chrome.runtime.sendMessage({ action: 'requestNextSyncTime' }, (response) => {
                if (response && response.success) {
                    updateSyncStatusUI(response.lastSyncTimestamp, response.nextSyncInSeconds);
                } else {
                    console.error("Failed to get next sync time after alarm start:", response?.error);
                    updateSyncStatusUI(null, undefined);
                }
            });
        } else {
            throw new Error(response.error || 'Failed to select team.');
        }
    } catch (err) {
        console.error('Error selecting team:', err);
        statusMessageDiv.textContent = `Error selecting team: ${err.message}`;
    }
});

// Load activities and counts for the selected team
async function loadInitialCountsAndActivities(team) {
    if (!team) return;

    // Clear activity list immediately to prevent flicker/stale data
    activityListDiv.innerHTML = '';
    activityListDiv.style.display = 'none';

    try {
        activities = await fetchActivitiesForTeam(team);

        // Load persisted order and apply it
        await loadActivityOrder();

        const todayDateKey = getTodayDateKey();
        if (!loggedInUserEmail) {
            const obj = await chrome.storage.sync.get('loggedInUserEmail');
            loggedInUserEmail = obj.loggedInUserEmail || null;
            if (!loggedInUserEmail) {
                statusMessageDiv.textContent = 'User email not found. Please log in again.';
                return;
            }
        }
        const activityStorageKey = `activityData_${loggedInUserEmail}_${todayDateKey}`;
        const runningTotalStorageKey = `runningTotals_${loggedInUserEmail}_${todayDateKey}`;

        const result = await chrome.storage.local.get([activityStorageKey, runningTotalStorageKey]);
        const storedActivityData = result[activityStorageKey];
        const storedRunningTotalData = result[runningTotalStorageKey];

        // Initialize activityCounts from local storage (these are the current session's inputs)
        activities.forEach(act => activityCounts[act.id] = 0);
        if (storedActivityData && storedActivityData.activities) {
            for (const [activityId, data] of Object.entries(storedActivityData.activities)) {
                if (activities.some(act => act.id === activityId)) {
                    activityCounts[activityId] = data.count;
                }
            }
        }

        // Initialize runningTotals from local storage
        activities.forEach(act => runningTotals[act.id] = 0);
        if (storedRunningTotalData) {
            for (const [activityId, total] of Object.entries(storedRunningTotalData)) {
                if (activities.some(act => act.id === activityId)) {
                    runningTotals[activityId] = total;
                }
            }
        }

        renderActivitiesUI();
        updateActivityCountsUI();
        activityListDiv.style.display = 'block'; // Show after successful load
    } catch (error) {
        console.error('Error loading activities/counts:', error);
        statusMessageDiv.textContent = 'Error loading activities. Please try again.';
        activityListDiv.innerHTML = '';
        activityListDiv.style.display = 'none';
    }
}

function renderActivitiesUI() {
    activityListDiv.innerHTML = '';
    // Add the grid-header back when rendering activities
    const headerDiv = document.createElement('div');
    headerDiv.className = 'grid-header';
    headerDiv.innerHTML = '<p>Task Name</p><p>Count</p><p>Today Total</p>';
    activityListDiv.appendChild(headerDiv);

    if (!activities || activities.length === 0) {
        const noActivitiesMessage = document.createElement('p');
        noActivitiesMessage.textContent = 'No activities found for this team.';
        activityListDiv.appendChild(noActivitiesMessage);
        return;
    }

    activities.forEach(activity => {
        const activityDiv = document.createElement('div');
        activityDiv.className = 'activity-item';
        activityDiv.dataset.activityId = activity.id; // Needed for Sortable

        const label = document.createElement('span');
        label.className = 'activity-name';
        label.textContent = activity.name;

        // Create the new activity-controls div
        const activityControlsDiv = document.createElement('div');
        activityControlsDiv.className = 'activity-controls';

        const btnMinus = document.createElement('button');
        btnMinus.textContent = `-`;
        btnMinus.title = 'Decrease count';
        btnMinus.className = 'btn btn-minus';

        const input = document.createElement('input');
        input.type = 'number';
        input.min = 0;
        input.value = activityCounts[activity.id] || 0; // Current count (local input)
        input.className = 'activity-count';
        input.dataset.activityId = activity.id;

        const btnPlus = document.createElement('button');
        btnPlus.textContent = '+';
        btnPlus.title = 'Increase count';
        btnPlus.className = 'btn';

        const runningTotalSpan = document.createElement('span'); // New element for running total
        runningTotalSpan.className = 'running-total';
        runningTotalSpan.dataset.activityId = activity.id; // Store activityId for easy update
        runningTotalSpan.textContent = `Total: ${runningTotals[activity.id] || 0}`; // Display running total

        // Append buttons and input to the new activityControlsDiv
        activityControlsDiv.appendChild(btnMinus);
        activityControlsDiv.appendChild(input);
        activityControlsDiv.appendChild(btnPlus);

        // Append all parts to the activityDiv
        activityDiv.appendChild(label);
        activityDiv.appendChild(activityControlsDiv); // Append the controls wrapper
        activityDiv.appendChild(runningTotalSpan); // Add the running total span

        // Add event listeners (these remain the same)
        btnMinus.addEventListener('click', async () => {
            let val = parseInt(input.value) || 0;
            if (val > 0) val--;
            input.value = val;
            activityCounts[activity.id] = val; // Update local activityCounts
            await updateLocalActivityData(activity.id, val, activity.name);
            // No need to call updateActivityCountsUI here unless runningTotals change
        });

        btnPlus.addEventListener('click', async () => {
            let val = parseInt(input.value) || 0;
            val++;
            input.value = val;
            activityCounts[activity.id] = val; // Update local activityCounts
            await updateLocalActivityData(activity.id, val, activity.name);
            // No need to call updateActivityCountsUI here unless runningTotals change
        });

        input.addEventListener('change', async (e) => {
            let val = parseInt(e.target.value);
            if (isNaN(val) || val < 0) val = 0;
            e.target.value = val;
            activityCounts[activity.id] = val; // Update local activityCounts
            await updateLocalActivityData(activity.id, val, activity.name);
            // No need to call updateActivityCountsUI here unless runningTotals change
        });

        activityListDiv.appendChild(activityDiv);
    });

    // Enable drag-and-drop reordering (skip header)
    if (window.Sortable) {
        Sortable.create(activityListDiv, {
            animation: 150,
            handle: '.activity-name, .running-total', // Only drag by name or total
            filter: '.grid-header',
            draggable: '.activity-item',
            onEnd: async function () {
                // Update activities array to match new order
                const newOrder = [];
                activityListDiv.querySelectorAll('.activity-item').forEach(div => {
                    const id = div.dataset.activityId;
                    const act = activities.find(a => a.id === id);
                    if (act) newOrder.push(act);
                });
                activities = newOrder;
                await saveActivityOrder(); // Persist new order
            }
        });
    }
}

function updateActivityCountsUI() {
    const inputs = activityListDiv.querySelectorAll('input.activity-count');
    inputs.forEach(input => {
        const id = input.dataset.activityId;
        input.value = activityCounts[id] || 0; // Display current session's count
    });

    const totalSpans = activityListDiv.querySelectorAll('span.running-total');
    totalSpans.forEach(span => {
        const id = span.dataset.activityId;
        const totalValue = runningTotals[id] || 0; // Retrieve value from in-memory runningTotals
        span.textContent = ` Total: ${totalValue}`; // Display cumulative running total
        console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: Updating UI for ${id}. Running total: ${totalValue}`);
    });
    console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: updateActivityCountsUI finished.`);
}

async function updateLocalActivityData(activityId, count, activityName) {
    const todayDateKey = getTodayDateKey();
    const data = {
        team: currentTeam,
        activities: { // Ensure this is 'activities' to match background.js structure
            [activityId]: {
                count: count,
                name: activityName
            }
        }
    };
    try {
        console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: Attempting to update local activity data for ${activityId} to ${count}`);
        await sendMessageToBackground({
            action: 'updateLocalActivityData',
            userEmail: loggedInUserEmail,
            todayDateKey,
            activityId,
            data
        });
        console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: Successfully sent updateLocalActivityData message.`);
    } catch (error) {
        console.error('Failed to update local activity data:', error);
        statusMessageDiv.textContent = 'Failed to save activity data locally.';
    }
}


async function updateLocalRunningTotals(syncedActivities) {
    console.log('syncedActivities:', syncedActivities);
    console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: Called updateLocalRunningTotals. LoggedInUserEmail: ${loggedInUserEmail}, CurrentTeam: ${currentTeam}`); // NEW LOG
    console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: updateLocalRunningTotals received syncedActivities:`, JSON.stringify(syncedActivities));
    const todayDateKey = getTodayDateKey();
    const runningTotalStorageKey = `runningTotals_${loggedInUserEmail}_${todayDateKey}`;
    console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: Constructed runningTotalStorageKey: ${runningTotalStorageKey}`); // NEW LOG

    // Fetch current running totals from storage
    const result = await chrome.storage.local.get(runningTotalStorageKey);
    const currentRunningTotals = result[runningTotalStorageKey] || {};
    console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: Current running totals from storage (before update):`, JSON.stringify(currentRunningTotals));

    // Update running totals based on synced activities
    syncedActivities.forEach(item => {
        const activityId = item.id;
        const count = item.count;

        if (activityId && typeof count === 'number') {
            currentRunningTotals[activityId] = (currentRunningTotals[activityId] || 0) + count;
            console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: Updated currentRunningTotals for ${activityId} to ${currentRunningTotals[activityId]} (added ${count})`);
        }
    });

    // Save the updated running totals back to storage
    await chrome.storage.local.set({ [runningTotalStorageKey]: currentRunningTotals });
    console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: Saved running totals to storage:`, JSON.stringify(currentRunningTotals));

    // Update the in-memory runningTotals object
    Object.assign(runningTotals, currentRunningTotals);
    console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: In-memory runningTotals after Object.assign:`, JSON.stringify(runningTotals));
}

// Listener for messages from background script about sync status and UI clear
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: Received message:`, request);
    if (request.action === "updateSyncStatus") {
        updateSyncStatusUI(request.lastSyncTimestamp, request.nextSyncInSeconds);
        // Optionally update status message from background
        if (request.statusMessage) {
            statusMessageDiv.textContent = request.statusMessage;
        } else if (request.error) {
            statusMessageDiv.textContent = `Sync Error: ${request.error}`;
        } else {
            statusMessageDiv.textContent = 'Sync status updated.';
        }
        console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: Handled updateSyncStatus.`);
        sendResponse({ success: true });
    } else if (request.action === "syncCompleteAndClearUI") {
        (async () => { // Make this section async to await storage retrieval
            console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: Handling syncCompleteAndClearUI.`);
            const tempSyncedActivitiesKey = request.tempSyncedActivitiesKey; // NEW: Get the key

            let syncedActivities = [];
            if (tempSyncedActivitiesKey) {
                try {
                    const result = await chrome.storage.local.get(tempSyncedActivitiesKey);
                    syncedActivities = result[tempSyncedActivitiesKey] || [];
                    console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: Retrieved synced activities from storage:`, syncedActivities); // NEW LOG
                    // Inform background to clear the temporary storage
                    await sendMessageToBackground({ action: 'sidepanelReadyForSyncedActivitiesClear', keyToClear: tempSyncedActivitiesKey });
                } catch (error) {
                    console.error(`[${new Date().toLocaleTimeString()}] Sidepanel: Error retrieving synced activities from storage:`, error);
                }
            } else {
                console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: No temporary storage key provided for synced activities.`);
            }

            // First, update running totals based on what was just synced
            if (syncedActivities.length > 0) {
                await updateLocalRunningTotals(syncedActivities); // Ensure this is awaited
            } else {
                console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: No synced activities to process for running totals.`);
            }

            // Then, reset all current activity counts in the UI to 0
            activities.forEach(act => activityCounts[act.id] = 0);
            console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: activityCounts reset to 0:`, activityCounts);
            updateActivityCountsUI(); // Re-render the UI with reset current counts and updated running totals
            updateSyncStatusUI(request.lastSyncTimestamp, request.nextSyncInSeconds);
            statusMessageDiv.textContent = 'Data synced and counts reset!';
            // Clear any previous timeout to avoid overlaps
            if (statusMessageTimeoutId) {
                clearTimeout(statusMessageTimeoutId);
            }
            if (statusMessageAlternateIntervalId) {
                clearInterval(statusMessageAlternateIntervalId);
            }

            // Set a timeout to start alternating messages after 10 seconds
            statusMessageTimeoutId = setTimeout(() => {
                function alternateStatusMessage() {
                    if (showWaiting) {
                        statusMessageDiv.textContent = 'Waiting for the next sync...';
                    } else if (loggedInUserEmail) {
                        statusMessageDiv.textContent = `Logged in as: ${loggedInUserEmail}`;
                    }
                    showWaiting = !showWaiting;
                }
                alternateStatusMessage(); // Show first message
                statusMessageAlternateIntervalId = setInterval(alternateStatusMessage, 40000);
                statusMessageTimeoutId = null;
            }, 25000);
            console.log(`[${new Date().toLocaleTimeString()}] Sidepanel: syncCompleteAndClearUI complete.`);
            sendResponse({ success: true }); // Acknowledge receipt after all processing
        })(); // Self-executing async function
        return true; // Indicate that sendResponse will be called asynchronously
    }
    return false; // For other messages, if any, that don't return true for async sendResponse
});

// --- Initialization ---
(async () => {
    try {
        const obj = await chrome.storage.sync.get('loggedInUserEmail');
        loggedInUserEmail = obj.loggedInUserEmail || null;

        if (loggedInUserEmail) {
            authSection.style.display = 'none';
            logoutButton.style.display = 'block';
            statusMessageDiv.textContent = `Logged in as: ${loggedInUserEmail}`;

            await showTeamSelection();

            chrome.runtime.sendMessage({ action: 'requestNextSyncTime' }, (response) => {
                if (response && response.success) {
                    updateSyncStatusUI(response.lastSyncTimestamp, response.nextSyncInSeconds);
                } else {
                    console.error("Failed to get initial next sync time:", response?.error);
                    updateSyncStatusUI(null, undefined);
                }});

            const tObj = await chrome.storage.sync.get('userTeam');
            const team = tObj.userTeam;
            if (team) {
                currentTeam = team;
                showSelectedTeam(team); // <-- Show the selected team row
                activityListDiv.style.display = 'block';
                await loadInitialCountsAndActivities(team);
            } else {
                await showTeamSelection(); // <-- Show the team selection UI
            }
        } else {
            updateSyncStatusUI(null, undefined);
            authButton.style.display = 'block';
            authSection.style.display = '';
            logoutButton.style.display = 'none';
            teamSelectionDiv.style.display = 'none';
            activityListDiv.style.display = 'none';
            statusMessageDiv.textContent = 'Not logged in.';
        }
    } catch (error) {
        console.error('Initialization error:', error);
        statusMessageDiv.textContent = 'Initialization error. Please reload.';
    }
})();