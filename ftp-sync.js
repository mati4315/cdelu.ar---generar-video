const ftp = require("basic-ftp");

async function uploadAdminChanges() {
    const client = new ftp.Client();
    try {
        await client.access({
            host: "195.35.41.78",
            user: "u692901087",
            password: "Mati4315.",
            secure: false
        });
        
        await client.uploadFrom("class-cdelu-admin.php", "/domains/cdelu.io/public_html/wp-content/plugins/includes/class-cdelu-admin.php");
        console.log("Uploaded class-cdelu-admin.php");
        
        await client.uploadFrom("video-logs-page.php", "/domains/cdelu.io/public_html/wp-content/plugins/templates/video-logs-page.php");
        console.log("Uploaded video-logs-page.php");
        
    } catch(err) {
        console.error("FTP Error: ", err);
    } finally {
        client.close();
    }
}

uploadAdminChanges();
