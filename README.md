# Google Tag Manager (GTM) Status Monitor
Since GTM does not allow you to monitor container publications other than through the email address of a Google account, this tool allows you to monitor the version of your GTM container at set intervals (every hour, day, ...) with the help of a Google Cloud Function and send an update to a Slack webhook for a notification in a Slack channel of your choice. You can find [a full writeup on my blog](https://www.dumky.net/posts/monitor-google-tag-manager-version-status-and-send-notifications-to-slack-the-easy-way-zapier-and-hard-way-gcp/?utm_source=github)

## Set up with Google Cloud Platform
* Set up a Cloud Scheduler cron trigger to trigger a pub/sub event e.g. every day at 07:00 (`0 7 * * *`). Create a pub/sub topic called `gtm-status-monitor`, or whatever topic name you prefer when setting up the trigger.
* Create a storage bucket (.e.g named `gtm-status-monitor`) and add the two JSON files 
    * `container_versions.json`: storage for version info
    * `check_containers.json`: an array of containers to check. You can either add the container ID and account ID for which you have given a service account access (e.g. the default App Engine service account) or use a name of your choice and a URL pointing to the GTM script that you like to keep tabs on. The first will give you more details like version name and description.
* Add the code from `status-monitor.js` to a (GCP) Cloud Function and let it trigger by the pub/sub topic `gtm-status-monitor` (or whatever you picked above). 
* Set up an environment variable called `SLACK_ENDPOINT`. Add the webhook URL that you can [create in your custom Slack app](https://api.slack.com/messaging/webhooks).
* If you used a different bucket name for your cloud storage, add it as an environment variable as well, named `STORAGE_BUCKET`.
* Deploy the function and you're good to go! The first trigger will show you a notification of the versions going from 0 to the current live version.