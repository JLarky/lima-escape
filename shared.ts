export async function startServer() {
    console.log('starting server');

    using tmpDir = randomDir();
    console.log('tmpDir', tmpDir.tmpDir);

    await receiveMessages(tmpDir.tmpDir + '/socket', async (message, sendResponse) => {
        console.log("Received:", message);
        const { args } = JSON.parse(message);
        console.log('running cursor with args', args);
        // Define the command to run 'echo "Hello from Deno!"'
        const command = new Deno.Command("cursor", {
            args: args,
        });

        // Execute the command and wait for its output
        const { code, stdout, stderr } = await (async () => await command.output())().catch(e => {
            console.error('error', e);
            return { code: 1, stdout: new TextEncoder().encode(`Failed to execute a command in lima-code server: ${e}`), stderr: new TextEncoder().encode('Error') };
        });

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
