# Team Activity Tracker Chrome Extension

A comprehensive Chrome Extension designed for teams and agents to track, log, and manage their daily work activities in real-time. This tool helps organizations capture valuable productivity data that cannot be automatically logged by traditional monitoring systems.

## 🚀 Features

### Core Functionality
- **Real-time Activity Tracking**: Track various work activities and tasks throughout your workday
- **Team-based Organization**: Select and work within specific team contexts for better data organization
- **Google Sheets Integration**: Automatic synchronization of activity data to Google Sheets for analysis and reporting
- **Persistent Data Storage**: Local storage ensures no data loss between sessions
- **Automatic Sync**: Scheduled data uploads every 15 minutes to maintain data freshness
- **User Authentication**: Secure Google OAuth2 login for personalized tracking
- **Dark/Light Theme**: Customizable interface themes for user comfort

### User Interface
- **Side Panel Integration**: Seamlessly integrated into Chrome's side panel for easy access
- **Drag & Drop**: Sortable activity list for personalized organization
- **Real-time Counters**: Live updates of activity counts and running totals
- **Sync Status Display**: Visual indicators showing last sync time and next scheduled sync
- **Team Selection**: Dropdown interface for switching between different teams

## 🔧 How It Works

### 1. User Authentication & Setup
- Users log in using their Google account through OAuth2 authentication
- Upon login, users select their team from a predefined list
- The extension maintains session state and remembers user preferences

### 2. Activity Tracking Process
- Activities are loaded dynamically from a centralized Google Sheets database
- Users can increment counters for different activities throughout their workday
- All activity data is stored locally in Chrome's storage for immediate access
- Running totals are maintained to show cumulative daily progress

### 3. Data Synchronization
- **Automatic Sync**: Every 15 minutes, the extension automatically uploads activity data to Google Sheets
- **Data Persistence**: Local data is cleared after successful sync to prevent duplication
- **Error Handling**: Robust error handling ensures data integrity during sync failures
- **Manual Sync**: Users can monitor sync status and timing through the interface

### 4. Data Storage Structure
- **Local Storage**: Temporary activity counts stored with user email and date keys
- **Google Sheets**: Permanent storage with columns for timestamp, user email, activity name, and count
- **Team Context**: All data is associated with the user's selected team for organizational clarity

## 🔒 Data Security & Privacy

### Data Collection & Usage
The Activity Tracker extension is designed with privacy and security as top priorities:

#### What Data We Collect:
- **User Email**: Retrieved from Google OAuth for user identification and data association
- **Activity Counts**: Numerical counts of work activities performed by the user
- **Team Assignment**: User's selected team for organizational context
- **Timestamps**: When activities were logged for temporal analysis
- **Theme Preferences**: User interface customization choices

#### What Data We DON'T Collect:
- **No Browsing History**: The extension does not track or record websites visited
- **No Personal Content**: No access to emails, documents, or personal files
- **No Keystroke Logging**: No monitoring of typing or keyboard activity
- **No Screen Recording**: No screenshots or screen monitoring capabilities

### Security Measures

#### Authentication Security:
- **Google OAuth2**: Industry-standard authentication protocol
- **Token Management**: Secure token storage and automatic token refresh
- **Revocation Support**: Complete token revocation on logout for security

#### Data Protection:
- **HTTPS Only**: All API communications use encrypted HTTPS connections
- **Minimal Permissions**: Extension requests only necessary permissions for functionality
- **Local Data Encryption**: Chrome's built-in storage encryption protects local data
- **No Third-party Tracking**: No external analytics or tracking services

#### Access Controls:
- **User-specific Data**: Each user can only access their own activity data
- **Team-based Segregation**: Data is organized by team for appropriate access control
- **Session Management**: Automatic logout and data clearing capabilities

### Data Storage & Retention

#### Local Storage (Chrome Extension):
- **Temporary Nature**: Local data is automatically cleared after successful sync
- **User Control**: Users can logout to clear all local data immediately
- **Secure Storage**: Utilizes Chrome's encrypted storage mechanisms

#### Google Sheets Storage:
- **Centralized Database**: Activity data stored in organization-controlled Google Sheets
- **Access Control**: Sheet access managed through Google's permission system
- **Data Ownership**: Organization maintains full control over their data
- **Audit Trail**: Complete timestamp records for all activities

### Compliance & Best Practices
- **Minimal Data Principle**: Only collects data essential for functionality
- **Transparency**: Open-source nature allows for code auditing
- **User Consent**: Clear permissions model with user approval required
- **Data Portability**: Google Sheets format ensures data can be exported easily

## 🛠 Technical Architecture

### Extension Components:
- **Manifest V3**: Built using the latest Chrome Extension standards
- **Service Worker**: Background script handles data sync and authentication
- **Side Panel**: Modern UI integrated into Chrome's interface
- **OAuth2 Integration**: Secure Google authentication flow

### APIs & Services:
- **Google Sheets API**: For data storage and retrieval
- **Google OAuth2**: For user authentication
- **Chrome Storage API**: For local data persistence
- **Chrome Alarms API**: For scheduled sync operations

### Permissions Used:
- `identity`: For Google OAuth authentication
- `storage`: For local data persistence
- `scripting`: For extension functionality
- `activeTab`: For current tab context
- `sidePanel`: For side panel integration
- `alarms`: For scheduled synchronization

## 📋 Installation & Setup

1. **Extension Installation**: Load the extension in Chrome Developer Mode
2. **First Login**: Click "Login with Google" and authorize the extension
3. **Team Selection**: Choose your team from the dropdown menu
4. **Start Tracking**: Begin logging activities using the activity counters

## 🎯 Use Cases

- **Customer Service Teams**: Track call types, issue resolutions, and support activities
- **Sales Teams**: Log prospect interactions, demo sessions, and follow-up activities
- **Development Teams**: Track code reviews, bug fixes, and feature development
- **Administrative Teams**: Monitor task completion, document processing, and communication activities

## 📊 Data Output

Activity data is automatically organized in Google Sheets with the following structure:
- **Timestamp**: When the activity was recorded
- **User Email**: Who performed the activity
- **Activity Name**: What activity was performed
- **Count**: How many times the activity was performed

This structured data enables powerful analytics and reporting capabilities for team management and productivity analysis.
