(() => {
    const fs = require("fs");
    const zlib = require("zlib");
    const child_process = require("child_process");
    const path = require("path");
    const version = "1.0.0";

    let clickListener = null;
    let saveListener = null;

    let projectName;

    BBPlugin.register("wakatime", {
        title: "Blockbench Wakatime",
        author: "ItsFelix5",
        description: "A plugin to track your Blockbench time using Wakatime.",
        icon: "fas.fa-circle-check",
        version,
        variant: "desktop",
        repository: "https://github.com/ItsFelix5/blockbench-wakatime",
        onload: async function () {
            console.log("Wakatime plugin loaded");

            if (!isCLIInstalled()) {
                installCLI();
            }

            isCLILatest((isLatest) => {
                if (!isLatest) {
                    installCLI();
                }
            });

            let config = fs.readFileSync(getConfigFile()).toString();
            const settings = parseINIString(config)["settings"] || {};

            const staturBar = document.getElementById("status_bar");
            const wakatimeDiv = document.createElement("div");
            wakatimeDiv.id = "wakatime";
            staturBar.appendChild(wakatimeDiv);

            if (!settings["api_key"]) {
                updateStatusBar("Wakatime API Key not found.");
                const form = {
                    api_key: {
                        label: "Wakatime API Key",
                        description: "Enter your Wakatime API key here.",
                    },
                };
                const dialog = new Dialog({
                    id: "wakatime_api_key",
                    title: "Wakatime API Key Required",
                    width: 400,
                    form,
                    onConfirm: (res) => {
                        const apiKey = res["api_key"];
                        if (apiKey) {
                            if (config.includes("[settings]")) {
                                config = config.replace(
                                    "[settings]",
                                    `[settings]\napi_key = ${apiKey} \n`
                                );
                            } else {
                                config =
                                    `[settings]\napi_key = ${apiKey} \n` +
                                    config;
                            }
                            fs.writeFileSync(getConfigFile(), config);
                            dialog.close();
                            wakatimeDiv.style.cursor = "default";
                            getCodingActivity();
                        } else {
                            new Dialog({
                                title: "Error",
                                message: "Please enter a valid API key.",
                            });
                        }
                    },
                });

                wakatimeDiv.addEventListener("click", () => {
                    dialog.show();
                });

                wakatimeDiv.style.cursor = "pointer";
            }

            projectName = await getProject();

            clickListener = async () => await sendHeartBeat();
            document.addEventListener("click", clickListener);

            saveListener = async () => await sendHeartBeat(true);

            document.addEventListener("keydown", (e) => {
                if (e.ctrlKey && e.key === "s") {
                    if (saveListener) {
                        saveListener();
                    }
                }
            });
        },
        onunload: function () {
            console.log("Wakatime plugin unloaded");
            if (clickListener) {
                document.removeEventListener("click", clickListener);
                clickListener = null;
            }
            if (saveListener) {
                document.removeEventListener("keydown", saveListener);
                saveListener = null;
            }
            const wakatimeDiv = document.getElementById("wakatime");
            if (wakatimeDiv) {
                wakatimeDiv.remove();
            }
        },
    });

    let lastHeartBeatAt = 0;

    function getProject() {
        return new Promise(r => {
            const dialog = new Dialog({
                id: "project_name",
                title: "What are you working on?",
                width: 400,
                form: {
                    project_name: {
                        label: "Project Name",
                        description: "Enter your project name here.",
                    },
                },
                onConfirm: (res) => {
                    dialog.close();
                    r(res["project_name"]);
                },
            });
        });
    }

    function updateStatusBar(text) {
        document.getElementById("wakatime").innerHTML = text;
    }

    async function sendHeartBeat(write) {
        if (!isCLIInstalled()) return installCLI();

        const time = Date.now();

        const project = Project;

        if (project === 0) return;

        if (time - lastHeartBeatAt < 120000) {
            return;
        }
        lastHeartBeatAt = time;

        const config = fs.readFileSync(getConfigFile()).toString();
        const settings = parseINIString(config)["settings"] || {};

        if (!settings["api_key"]) {
            console.error("Wakatime API key not found");
            return;
        }

        const apiUrl =
            settings["api_url"] ||
            "https://api.wakatime.com/api/v1/users/current/heartbeats";
        const apiKey = settings["api_key"];

        const entity =
            Project.save_path && Project.save_path.length > 0
                ? Project.save_path
                : Project.name;

        const args = [
            "--key",
            apiKey,
            "--plugin",
            `Blockbench/${Blockbench.version} BlockbenchWakatime/${version}`,
            "--entity",
            entity,
            "--entity-type",
            "app",
            "--project",
            projectName,
            "--language",
            "BBModel",
        ];

        if (apiUrl) args.push("--api-url", apiUrl);

        if (write) args.push("--write");

        let proc = child_process.execFile(
            getCliLocation(),
            args,
            {},
            (e, stdout, stderr) => {
                if (e) {
                    if (stderr && stderr.toString().length > 0)
                        console.error(stderr.toString());
                    if (stdout && stdout.toString().length > 0)
                        console.log(stdout.toString());
                    console.error(e);
                }
            }
        );
        proc.on("close", (code) => {
            if (code == 0) {
            } else if (code == 102 || code == 112) {
                updateStatusBar("Offline");
            } else if (code == 103) {
                updateStatusBar("Config parsing error");
            } else if (code == 104) {
                updateStatusBar("Invalid API key");
            } else {
                console.error("Error sending heartbeat", code);
            }
        });

        await getCodingActivity();
    }

    async function getCodingActivity() {
        if (!isCLIInstalled()) return installCLI();

        const config = fs.readFileSync(getConfigFile()).toString();
        const settings = parseINIString(config)["settings"] || {};

        if (!settings["api_key"]) {
            console.error("Wakatime API key not found");
            return;
        }

        const apiUrl =
            settings["api_url"] ||
            "https://api.wakatime.com/api/v1/users/current/heartbeats";
        const apiKey = settings["api_key"];

        const args = [
            "--key",
            apiKey,
            "--today",
            "--output",
            "json",
            "--plugin",
            `Blockbench/${Blockbench.version} BlockbenchWakatime/${version}`,
        ];

        if (apiUrl) args.push("--api-url", apiUrl);

        try {
            let proc = child_process.execFile(
                getCliLocation(),
                args,
                {},
                (e, stdout, stderr) => {
                    if (e) {
                        if (stderr && stderr.toString().length > 0)
                            console.error(stderr.toString());
                        if (stdout && stdout.toString().length > 0)
                            console.log(stdout.toString());
                        console.error(e);
                    }
                }
            );
            let output = "";
            if (proc.stdout) {
                proc.stdout.on("data", (data) => {
                    if (data) output += data;
                });
            }
            proc.on("close", (code) => {
                if (code == 0) {
                    let json;
                    try {
                        json = JSON.parse(output);
                    } catch (e) {
                        console.error("Error parsing JSON", e);
                    }
                    if (json) {
                        if (json.text && json.text.trim().length > 0) {
                            updateStatusBar(json.text.trim());
                        } else {
                            updateStatusBar("No coding activity found");
                        }
                    }
                } else if (code == 102 || code == 112) {
                    updateStatusBar("Offline");
                } else {
                    updateStatusBar("Wakatime Error");
                    console.error("Error getting coding activity", code);
                }
            });
        } catch (e) {
            console.error(e);
        }
    }

    // OS, Machine, Architecture

    function osName() {
        const name = process.platform;
        return name === "win32" ? "windows" : name;
    }

    function isWindows() {
        return process.platform === "win32";
    }

    function architecture() {
        const arch = process.arch;
        if (arch.indexOf("arm") > -1) return arch;
        if (arch.indexOf("32") > -1) return "386";
        return "amd64";
    }

    // File System

    function parseINIString(data) {
        var regex = {
            section: /^\s*\[\s*([^\]]*)\s*\]\s*$/,
            param: /^\s*([^=]+?)\s*=\s*(.*?)\s*$/,
            comment: /^\s*;.*$/,
        };
        var value = {};
        var lines = data.split(/[\r\n]+/);
        var section = null;
        lines.forEach(function (line) {
            if (regex.comment.test(line)) {
                return;
            } else if (regex.param.test(line)) {
                var match = line.match(regex.param);
                if (section) {
                    value[section][match[1]] = match[2];
                } else {
                    value[match[1]] = match[2];
                }
            } else if (regex.section.test(line)) {
                var match = line.match(regex.section);
                value[match[1]] = {};
                section = match[1];
            } else if (line.length == 0 && section) {
                section = null;
            }
        });
        return value;
    }

    function downloadFile(url, dest, callback) {
        const file = fs.createWriteStream(dest);
        fetch(url).then((r) => {
            r.body.pipe(file);
            file.on("finish", () => {
                file.close(callback);
            });
        });
    }

    async function parseZip(zip) {
        try {
            const ua = new Uint8Array(zip);
            const dv = new DataView(zip);
            const offEOCD = ua.findLastIndex(
                (e, i, a) =>
                    e === 0x50 &&
                    a[i + 1] === 0x4b &&
                    a[i + 2] === 0x05 &&
                    a[i + 3] === 0x06
            );
            const offCenDir = dv.getUint32(offEOCD + 16, true);
            const recordCount = dv.getUint16(offEOCD + 10, true);
            const parsedZip = {
                buffer: zip,
                array: ua,
                view: dv,
                eocdOffset: offEOCD,
                centralDirOffset: offCenDir,
                fileCount: recordCount,
                files: {},
            };
            for (let i = 0, o = offCenDir; i < recordCount; i++) {
                const n = dv.getUint16(o + 28, true);
                const m = dv.getUint16(o + 30, true);
                const k = dv.getUint16(o + 32, true);
                const encodedPath = ua.subarray(o + 46, o + 46 + n);
                const filePath = td.decode(encodedPath);

                const h = dv.getUint32(o + 42, true);
                const q = dv.getUint16(h + 8, true);
                const t = dv.getUint16(h + 10, true);
                const d = dv.getUint16(h + 12, true);
                const s = dv.getUint32(o + 20, true);
                const a = dv.getUint32(o + 24, true);
                const e = dv.getUint16(h + 28, true);

                parsedZip.files[filePath] = {
                    path: filePath,
                    compressedSize: s,
                    size: a,
                    crc32: dv.getUint32(o + 16, true),
                    timeValue: t,
                    dateValue: d,
                    encodedPath,
                    compressionMethod: q,
                    isDirectory: filePath.endsWith("/"),
                    compressedContent: ua.subarray(
                        h + 30 + n + e,
                        h + 30 + n + e + s
                    ),
                };

                if (q === 0) {
                    parsedZip.files[filePath].content =
                        parsedZip.files[filePath].compressedContent;
                } else {
                    Object.defineProperty(
                        parsedZip.files[filePath],
                        "content",
                        {
                            configurable: true,
                            enumerable: true,
                            get() {
                                const c = zlib.inflateRawSync(
                                    this.compressedContent
                                );
                                Object.defineProperty(this, "content", {
                                    value: c,
                                    configurable: true,
                                    enumerable: true,
                                });
                                return c;
                            },
                        }
                    );
                }

                o += 46 + n + m + k;
            }

            return parsedZip;
        } catch (e) {
            console.error(e);
            return null;
        }
    }

    async function unzip(zipFile, dest) {
        if (fs.existsSync(zipFile)) {
            const zip = fs.readFileSync(zipFile).buffer;
            const parsedZip = await parseZip(zip, dest);
            if (parsedZip) {
                for (const file of Object.values(parsedZip.files)) {
                    if (!file.isDirectory) {
                        const filePath = path.join(dest, file.path);
                        fs.mkdirSync(path.dirname(filePath), {
                            recursive: true,
                        });
                        fs.writeFileSync(filePath, file.content);
                    }
                }
            }
        }
    }

    // Wakatime CLI

    function isCLIInstalled() {
        return fs.existsSync(getCliLocation());
    }

    async function isCLILatest(callback) {
        var args = ["--version"];
        child_process.execFile(
            getCliLocation(),
            args,
            (error, stdout, stderr) => {
                if (error == null) {
                    var currentVersion = stdout.trim() + stderr.trim();
                    console.log(
                        `Current wakatime-cli version is ${currentVersion}`
                    );
                    console.log("Checking for updates to wakatime-cli...");
                    getLatestCliVersion().then((latestVersion) => {
                        if (currentVersion === latestVersion) {
                            console.log("wakatime-cli is up to date.");
                            if (callback) callback(true);
                        } else {
                            if (latestVersion != null) {
                                console.log(
                                    `Found an updated wakatime-cli ${latestVersion}`
                                );
                                if (callback) callback(false);
                            } else {
                                console.log(
                                    "Unable to find latest wakatime-cli version."
                                );
                                if (callback) callback(true);
                            }
                        }
                    });
                } else {
                    if (callback) callback(false);
                }
            }
        );
    }

    async function getLatestCliVersion() {
        try {
            const response = await fetch(
                "https://api.github.com/repos/wakatime/wakatime-cli/releases/latest",
                {
                    headers: {
                        "User-Agent":
                            "github.com/itzshubhamdev/blockbench-wakatime",
                    },
                }
            );

            if (!response.ok) {
                console.warn(`GitHub API error: ${response.status}`);
                return "";
            }

            const data = await response.json();
            return data.tag_name || "";
        } catch (error) {
            console.warn("Fetch error:", error);
            return "";
        }
    }

    function getResourcesLocation() {
        resourcesLocation = path.join(getHomeDirectory(), ".wakatime");
        try {
            fs.mkdirSync(resourcesLocation, { recursive: true });
        } catch (e) {
            log.error(e);
        }
        return resourcesLocation;
    }

    function getConfigFile(internal) {
        if (internal)
            return path.join(getHomeDirectory(), ".wakatime-internal.cfg");
        return path.join(getHomeDirectory(), ".wakatime.cfg");
    }

    function getHomeDirectory() {
        let home = process.env.WAKATIME_HOME;
        if (home && home.trim() && fs.existsSync(home.trim()))
            return home.trim();
        return process.env[isWindows() ? "USERPROFILE" : "HOME"] || "";
    }

    function getCliLocation() {
        const ext = isWindows() ? ".exe" : "";
        const osname = osName();
        const arch = architecture();
        return path.join(
            getResourcesLocation(),
            `wakatime-cli-${osname}-${arch}${ext}`
        );
    }

    function isSymlink(file) {
        try {
            return fs.lstatSync(file).isSymbolicLink();
        } catch (_) {}
        return false;
    }

    function installCLI(callback) {
        getLatestCliVersion((version) => {
            const url = cliDownloadUrl(version);
            console.log(`Downloading wakatime-cli from ${url}`);
            updateStatusBar("Downloading Wakatime-CLI...");
            const zipFile = path.join(
                getResourcesLocation(),
                "wakatime-cli.zip"
            );
            downloadFile(url, zipFile, async () => {
                await extractCLI(zipFile);
                const cli = getCliLocation();
                try {
                    console.log("Chmod 755 wakatime-cli...");
                    fs.chmodSync(cli, 0o755);
                } catch (e) {
                    log.warn(e);
                }
                const ext = isWindows() ? ".exe" : "";
                const link = path.join(
                    getResourcesLocation(),
                    `wakatime-cli${ext}`
                );
                if (!isSymlink(link)) {
                    try {
                        log.debug(`Create symlink from wakatime-cli to ${cli}`);
                        fs.symlinkSync(cli, link);
                    } catch (e) {
                        log.warn(e);
                        try {
                            fs.copyFileSync(cli, link);
                            fs.chmodSync(link, 0o755);
                        } catch (e2) {
                            log.warn(e2);
                        }
                    }
                }
            });
        });
    }

    async function extractCLI(zipFile) {
        console.log("Extracting wakatime-cli.zip file...");
        updateStatusBar("Extracting Wakatime-CLI...");
        await removeCLI();
        await unzip(zipFile, getResourcesLocation());
    }

    async function removeCLI() {
        try {
            await del([getCliLocation()], { force: true });
        } catch (e) {
            log.warn(e);
        }
    }

    function cliDownloadUrl(version) {
        const osname = osName();
        const arch = architecture();

        const validCombinations = [
            "darwin-amd64",
            "darwin-arm64",
            "freebsd-386",
            "freebsd-amd64",
            "freebsd-arm",
            "linux-386",
            "linux-amd64",
            "linux-arm",
            "linux-arm64",
            "netbsd-386",
            "netbsd-amd64",
            "netbsd-arm",
            "openbsd-386",
            "openbsd-amd64",
            "openbsd-arm",
            "openbsd-arm64",
            "windows-386",
            "windows-amd64",
            "windows-arm64",
        ];
        if (!validCombinations.includes(`${osname}-${arch}`)) {
            console.error(`Unsupported platform: ${osname}-${arch}`);
        }

        return `https://github.com/wakatime/wakatime-cli/releases/download/${version}/wakatime-cli-${osname}-${arch}.zip`;
    }
})();
