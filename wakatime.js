(() => {
	const fs = require("node:fs");
	const zlib = require("node:zlib");
	const child_process = require("node:child_process");
	const path = require("node:path");

	const updateStatusBar = (text) => wakatimeDiv.innerHTML = text;
	let clickListener = () => sendHeartBeat();
	let saveListener = (e) => {
		if (e.ctrlKey && e.key === "s") sendHeartBeat(true);
	};

	let wakatimeDiv;
	let apiUrl;
	let projectName;

	BBPlugin.register("wakatime", {
		title: "Blockbench Wakatime",
		author: "ItsFelix5",
		description: "A plugin to track your Blockbench time using Wakatime.",
		icon: "fas.fa-circle-check",
		version: "1.0.0",
		variant: "desktop",
		repository: "https://github.com/ItsFelix5/blockbench-wakatime",
		onload: async function () {
			wakatimeDiv = document.createElement("div");
			wakatimeDiv.style.cursor = "pointer";
			wakatimeDiv.onclick = () => askProjectName(() => sendHeartBeat());
			document.getElementById("status_bar").appendChild(wakatimeDiv);

			try {
				const response = await fetch("https://api.github.com/repos/wakatime/wakatime-cli/releases/latest");

				if (!response.ok) {
					console.warn(`GitHub API error: ${response.status}`);
					return;
				}

				const latestVersion = (await response.json()).tag_name;
				const cli = getCliLocation();
				if (latestVersion) child_process.execFile(
					cli,
					["--version"],
					(error, stdout) => {
						if (!error) {
							let currentVersion = stdout.trim();
							console.log(`Current wakatime-cli version is ${currentVersion}`);

							if (currentVersion === latestVersion) {
								console.log("wakatime-cli is up to date.");
								return;
							} else console.log(`Found an updated wakatime-cli ${latestVersion}`);
						} else console.error(error);
						const osArch = (isWindows() ? "windows" : process.platform) + '-' + architecture();

						if (![
							"darwin-amd64", "darwin-arm64",
							"freebsd-386", "freebsd-amd64", "freebsd-arm",
							"linux-386", "linux-amd64", "linux-arm", "linux-arm64",
							"netbsd-386", "netbsd-amd64", "netbsd-arm",
							"openbsd-386", "openbsd-amd64", "openbsd-arm", "openbsd-arm64",
							"windows-386", "windows-amd64", "windows-arm64",
						].includes(osArch)) console.error(`Unsupported platform: ${osArch}`);
						const url = `https://github.com/wakatime/wakatime-cli/releases/download/${version}/wakatime-cli-${osArch}.zip`;
						console.log(`Downloading wakatime-cli from ${url}`);
						const zipFile = path.join(getResourcesLocation(), "wakatime-cli.zip");
						const file = fs.createWriteStream(zipFile);
						fetch(url).then((r) => {
							r.body.pipe(file);
							file.on("finish", () => file.close(async () => {
								console.log("Extracting wakatime-cli.zip file...");

								try {
									await del([cli], {force: true});
								} catch (e) {
									log.warn(e);
								}
								await unzip(zipFile, getResourcesLocation());

								try {
									console.log("Chmod 755 wakatime-cli...");
									fs.chmodSync(cli, 0o755);
								} catch (e) {
									log.warn(e);
								}
								const link = path.join(getResourcesLocation(), `wakatime-cli${isWindows() ? ".exe" : ""}`);
								try {
									if (fs.lstatSync(link).isSymbolicLink()) return;
								} catch (_) {
								}
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
							}));
						});
					}
				);
				else console.log("Unable to find latest wakatime-cli version.");
			} catch (error) {
				console.warn("Fetch error:", error);
			}

			let config = fs.readFileSync(path.join(getHomeDirectory(), ".wakatime.cfg")).toString();
			let isSettings;
			config.split("\n").forEach(line => {
				line = line.trim();
				if (line.startsWith("[") && line.endsWith("]")) isSettings = line == "[settings]";
				else if (line.startsWith("api_url") && isSettings) apiUrl = line.split("=")[1].trim();
			});

			document.addEventListener("click", clickListener);
			document.addEventListener("keydown", saveListener);
		},
		onunload: function () {
			document.removeEventListener("click", clickListener);
			document.removeEventListener("keydown", saveListener);
			wakatimeDiv.remove();
		}
	});

	let lastHeartBeatAt = 0;
	let lastEntity;

	async function sendHeartBeat(write) {
		if (projectName === -1) return;
		if (!projectName) {
			projectName = -1;
			await new Promise(askProjectName);
		}

		const time = Date.now();
		const entity =
			Project.save_path && Project.save_path.length > 0
				? Project.save_path
				: Project.name && Project.name.length > 0
					? Project.name
					: "Unknown";

		if (!write && time - lastHeartBeatAt < 120000 && lastEntity === entity) return;

		lastHeartBeatAt = time;
		lastEntity = entity;

		const args = [
			"--plugin", `Blockbench/${Blockbench.version} BlockbenchWakatime/1.0.0`,
			"--entity", entity,
			"--entity-type", "app",
			"--project", projectName,
			"--language", "BBModel",
		];

		if (apiUrl) args.push("--api-url", apiUrl);
		if (write) args.push("--write");

		console.log(`Sending ${write ? "write" : ""} heartbeat for ${entity} in ${projectName}`);
		const cli = getCliLocation();
		let proc = child_process.execFile(
			cli,
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
			} else if (code == 102 || code == 112) updateStatusBar("Offline");
			else if (code == 103) updateStatusBar("Config parsing error");
			else if (code == 104) updateStatusBar("Invalid API key");
			else console.error("Error sending heartbeat", code);
		});

		const getArgs = [
			"--today",
			"--output", "json",
			"--plugin", `Blockbench/${Blockbench.version} BlockbenchWakatime/1.0.0`,
		];

		if (apiUrl) getArgs.push("--api-url", apiUrl);

		try {
			let proc = child_process.execFile(
				cli,
				getArgs,
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
			if (proc.stdout) proc.stdout.on("data", (data) => {
				if (data) output += data;
			});
			proc.on("close", (code) => {
				if (code == 0) {
					try {
						let json = JSON.parse(output);
						if (json.text && json.text.trim().length > 0) updateStatusBar(projectName + ";" + json.text.trim());
						else updateStatusBar("No coding activity found yet");
					} catch (e) {
						console.error("Error parsing JSON", e);
					}
				} else if (code == 102 || code == 112) updateStatusBar("Offline");
				else {
					updateStatusBar("Wakatime Error");
					console.error("Error getting coding activity", code);
				}
			});
		} catch (e) {
			console.error(e);
		}
	}

	function askProjectName(cb) {
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
				projectName = res["project_name"];
				dialog.close();
				lastHeartBeatAt = 0;
				cb();
			},
		});
		dialog.show();
	}

	function isWindows() {
		return process.platform === "win32";
	}

	function architecture() {
		return process.arch.includes("arm") ? process.arch : process.arch.includes("32") ? "386" : "amd64";
	}

	async function unzip(zipFile, dest) {
		if (fs.existsSync(zipFile)) {
			const zip = fs.readFileSync(zipFile).buffer;
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

					if (q === 0) parsedZip.files[filePath].content = parsedZip.files[filePath].compressedContent;
					else Object.defineProperty(
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

					o += 46 + n + m + k;
				}

				for (const file of Object.values(parsedZip.files)) {
					if (file.isDirectory) continue;
					const filePath = path.join(dest, file.path);
					fs.mkdirSync(path.dirname(filePath), {recursive: true});
					fs.writeFileSync(filePath, file.content);
				}
			} catch (e) {
				console.error(e);
			}
		}
	}

	function getResourcesLocation() {
		let resourcesLocation = path.join(getHomeDirectory(), ".wakatime");
		try {
			fs.mkdirSync(resourcesLocation, {recursive: true});
		} catch (e) {
			log.error(e);
		}
		return resourcesLocation;
	}

	function getHomeDirectory() {
		let home = process.env.WAKATIME_HOME;
		if (home && home.trim() && fs.existsSync(home.trim()))
			return home.trim();
		return process.env[isWindows() ? "USERPROFILE" : "HOME"] || "";
	}

	function getCliLocation() {
		return path.join(
			getResourcesLocation(),
			`wakatime-cli-${isWindows() ? "windows" : process.platform}-${architecture()}${isWindows() ? ".exe" : ""}`
		);
	}
})();
