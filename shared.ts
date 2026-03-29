async function runEditorCommand(args: string[]) {
    const commands = ["code", "cursor"];

    for (const cmd of commands) {
        try {
            console.log(`running ${cmd} with args`, args);
            const command = new Deno.Command(cmd, { args });
            const { code, stdout, stderr } = await command.output();
            return { code, stdout, stderr };
        } catch (e) {
            console.error(`${cmd} command failed:`, e);
            if (cmd === commands[commands.length - 1]) {
                // Last command failed, return error
                return {
                    code: 1,
                    stdout: new TextEncoder().encode(`Failed to execute a command in lima-code server: ${e}`),
                    stderr: new TextEncoder().encode('Error'),
                };
            }
            // Try next command
        }
    }

    return {
        code: 1,
        stdout: new TextEncoder().encode('No editor command available. Make sure that you are running the server inside of your editors built-in terminal.'),
        stderr: new TextEncoder().encode('Error'),
    };
}

export async function startServer() {
    console.log('starting server');

    using tmpDir = randomDir();
    console.log('tmpDir', tmpDir.tmpDir);

    await receiveMessages(tmpDir.tmpDir + '/socket', async (message, sendResponse) => {
        console.log("Received:", message);
        const { args } = JSON.parse(message);

        const { code, stdout, stderr } = await runEditorCommand(args);

        console.log('exit code', code);

        // Convert output to string and log it
        console.log(new TextDecoder().decode(stdout)); // "Hello from Deno!"
        console.log(new TextDecoder().decode(stderr)); // ""

        await sendResponse(new TextDecoder().decode(stdout) || "Done with no output");
    });
}

async function receiveMessages(socketPath: string, onMessage: (message: string, sendResponse: (response: string) => Promise<void>) => Promise<void>) {
    const listener = Deno.listen({
        transport: "unix",
        path: socketPath,
    });

    for await (const conn of listener) {
        // Handle incoming connections here
        (async () => {
            const buffer = new Uint8Array(1024);
            const bytesRead = await conn.read(buffer);
            if (bytesRead) {
                const message = new TextDecoder().decode(buffer.subarray(0, bytesRead));
                await onMessage(message, async (response) => {
                    await conn.write(new TextEncoder().encode(response));
                });
            }
            conn.close();
        })();
    }
}

export async function startClient(socketPath: string, message: string) {
    console.log('starting client', socketPath);
    console.log("Server response:", await sendMessage(socketPath, message));
}

async function sendMessage(socketPath: string, message: string) {
    const conn = await Deno.connect({
        transport: "unix",
        path: socketPath, // Match the server's path
    });

    const { promise, reject, resolve } = Promise.withResolvers<string>();

    try {

        await conn.write(new TextEncoder().encode(message));

        const buffer = new Uint8Array(1024);
        const bytesRead = await conn.read(buffer);
        if (bytesRead) {
            resolve(new TextDecoder().decode(buffer.subarray(0, bytesRead)));
        }
        else {
            reject(new Error('No response from server'));
        }

        conn.close();
    } catch (error) {
        reject(error);
    }

    return promise;
}

function randomDir() {
    const tmpDir = Deno.makeTempDirSync({ prefix: 'lima-code-' });
    Deno.addSignalListener("SIGINT", () => {
        Deno.removeSync(tmpDir, { recursive: true });
    });
    globalThis.addEventListener("unload", () => {
        Deno.removeSync(tmpDir, { recursive: true });
    });
    return {
        [Symbol.dispose]: () => {
            Deno.removeSync(tmpDir, { recursive: true });
        },
        tmpDir,
    }
}
