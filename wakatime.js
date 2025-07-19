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
			wakatimeDiv.innerHTML = "Wakatime";
			wakatimeDiv.style.cursor = "pointer";
			wakatimeDiv.onclick = () => askProjectName(() => sendHeartBeat());
			document.getElementById("status_bar").appendChild(wakatimeDiv);

			try {
				const response = await fetch("https://api.github.com/repos/wakatime/wakatime-cli/releases/latest");

				if (!response.ok) {
					console.warn(`GitHub API error: ${response.status}`);
					return;
				}

				const latestVersion = (await response.json())["tag_name"];
				if (!latestVersion) throw "Tag name is " + latestVersion;

				const resourcesLocation = path.join(getHomeDirectory(), ".wakatime");
				fs.mkdirSync(resourcesLocation, {recursive: true});
				const platform = osArch();
				if (![
					"darwin-amd64", "darwin-arm64",
					"freebsd-386", "freebsd-amd64", "freebsd-arm",
					"linux-386", "linux-amd64", "linux-arm", "linux-arm64",
					"netbsd-386", "netbsd-amd64", "netbsd-arm",
					"openbsd-386", "openbsd-amd64", "openbsd-arm", "openbsd-arm64",
					"windows-386", "windows-amd64", "windows-arm64",
				].includes(platform)) console.error(`Unsupported platform: ${platform}`);
				const cli = path.join(
					resourcesLocation,
					`wakatime-cli-${platform}${isWindows() ? ".exe" : ""}`
				);

				child_process.execFile(
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

						const url = `https://github.com/wakatime/wakatime-cli/releases/download/${latestVersion}/wakatime-cli-${platform}.zip`;
						console.log(`Downloading wakatime-cli from ${url}`);
						const zipFile = path.join(resourcesLocation, "wakatime-cli.zip");
						const file = fs.createWriteStream(zipFile);
						fetch(url).then((r) => {
							r.body.pipe(file);
							file.on("finish", () => file.close(async () => {
								console.log("Extracting wakatime-cli.zip file...");

								try {
									fs.rmSync(cli, {force: true});
								} catch (e) {
									console.warn(e);
								}
								await unzip(zipFile, resourcesLocation);

								try {
									console.log("Chmod 755 wakatime-cli...");
									fs.chmodSync(cli, 0o755);
								} catch (e) {
									console.warn(e);
								}
								const link = path.join(resourcesLocation, `wakatime-cli${isWindows() ? ".exe" : ""}`);
								try {
									if (fs.lstatSync(link).isSymbolicLink()) return;
								} catch (_) {
								}
								try {
									console.debug(`Create symlink from wakatime-cli to ${cli}`);
									fs.symlinkSync(cli, link);
								} catch (e) {
									console.warn(e);
									try {
										fs.copyFileSync(cli, link);
										fs.chmodSync(link, 0o755);
									} catch (e2) {
										console.warn(e2);
									}
								}
							}));
						});
					}
				);
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
		const cli = path.join(
			getHomeDirectory(), ".wakatime",
			`wakatime-cli-${osArch()}${isWindows() ? ".exe" : ""}`
		);
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

	function osArch() {
		return (isWindows() ? "windows" : process.platform) + '-' + (process.arch.includes("arm") ? process.arch : process.arch.includes("32") ? "386" : "amd64");
	}

	async function unzip(zipFile, dest) {
		if (!fs.existsSync(zipFile)) return;
		const td = new TextDecoder;
		const zip = fs.readFileSync(zipFile).buffer;
		try {
			const array = new Uint8Array(zip);
			const data = new DataView(zip);
			const offEOCD = array.findLastIndex(
				(e, i, a) =>
					e === 0x50 &&
					a[i + 1] === 0x4b &&
					a[i + 2] === 0x05 &&
					a[i + 3] === 0x06
			);
			const recordCount = data.getUint16(offEOCD + 10, true);
			for (let i = 0, pos = data.getUint32(offEOCD + 16, true); i < recordCount; i++) {
				const n = data.getUint16(pos + 28, true);
				const filePath = td.decode(array.subarray(pos + 46, pos + 46 + n));
				if (!filePath.endsWith("/")) {
					const absPath = path.join(dest, filePath);
					fs.mkdirSync(path.dirname(absPath), {recursive: true});
					const h = data.getUint32(pos + 42, true);
					const contentStart = h + 30 + n + data.getUint16(h + 28, true);
					const compressedContent = array.subarray(contentStart, contentStart + data.getUint32(pos + 20, true));
					fs.writeFileSync(absPath, data.getUint16(h + 8, true) === 0 ? compressedContent : zlib.inflateRawSync(compressedContent));
				}

				pos += 46 + n + data.getUint16(pos + 30, true) + data.getUint16(pos + 32, true);
			}
		} catch (e) {
			console.error(e);
		}
	}

	function getHomeDirectory() {
		let home = process.env.WAKATIME_HOME?.trim();
		if (home && fs.existsSync(home)) return home;
		return process.env[isWindows() ? "USERPROFILE" : "HOME"] || "";
	}
})();
