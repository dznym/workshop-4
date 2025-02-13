import bodyParser from "body-parser";
import express from "express";
import { BASE_ONION_ROUTER_PORT, REGISTRY_PORT } from "../config";
import crypto from "crypto";
import http from "http";
import { rsaDecrypt, importSymKey, symDecrypt, importPrvKey } from "../crypto";

export async function simpleOnionRouter(nodeId: number) {
  const onionRouter = express();
  onionRouter.use(express.json());
  onionRouter.use(bodyParser.json());

  // State variables
  let lastReceivedEncryptedMessage: string | null = null;
  let lastReceivedDecryptedMessage: string | null = null;
  let lastMessageDestination: number | null = null;

  // Generate RSA key pair
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  // Export keys and convert to Web Crypto format
  const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
  const publicKeyBase64 = Buffer.from(publicKeyDer).toString("base64");
  const privateKeyDer = privateKey.export({ type: "pkcs8", format: "der" });
  const privateKeyBase64 = Buffer.from(privateKeyDer).toString("base64");
  const privateKeyCrypto = await importPrvKey(privateKeyBase64);

  // Register node with registry
  const postData = JSON.stringify({ nodeId, pubKey: publicKeyBase64 });
  const req = http.request({
    hostname: 'localhost',
    port: REGISTRY_PORT,
    path: '/registerNode',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    },
  });
  
  req.on('error', (err) => console.error("Registration error:", err));
  req.write(postData);
  req.end();

  // Routes
  onionRouter.get("/status", (req, res) => res.send("live"));

  onionRouter.get("/getLastReceivedEncryptedMessage", (req, res) => {
    res.json({ result: lastReceivedEncryptedMessage });
  });

  onionRouter.get("/getLastReceivedDecryptedMessage", (req, res) => {
    res.json({ result: lastReceivedDecryptedMessage });
  });

  onionRouter.get("/getLastMessageDestination", (req, res) => {
    res.json({ result: lastMessageDestination });
  });

  onionRouter.get("/getPrivateKey", (req, res) => {
    res.json({ result: privateKeyBase64 });
  });

  // Add message processing route
  onionRouter.post("/message", async (req, res) => {
    try {
      const { message } = req.body;
      lastReceivedEncryptedMessage = message;

      // Split into encrypted key (344 chars) and payload
      const encryptedKey = message.substring(0, 344);
      const encryptedPayload = message.substring(344);

      // Decrypt symmetric key with node's private key
      const symmetricKeyBase64 = await rsaDecrypt(encryptedKey, privateKeyCrypto);
      const symmetricKey = await importSymKey(symmetricKeyBase64);

      // Decrypt payload with symmetric key
      const decrypted = await symDecrypt(symmetricKeyBase64, encryptedPayload);
      const nextDestination = parseInt(decrypted.substring(0, 10), 10);
      const innerMessage = decrypted.substring(10);

      // Update node state
      lastReceivedDecryptedMessage = innerMessage;
      lastMessageDestination = nextDestination;

      // Forward to next node/user
      await fetch(`http://localhost:${nextDestination}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: innerMessage }),
      });

      res.status(200).send("success");
    } catch (error) {
      console.error("Node processing error:", error);
      res.status(500).send("error");
    }
  });

  const server = onionRouter.listen(BASE_ONION_ROUTER_PORT + nodeId, () => {
    console.log(`Onion router ${nodeId} listening on port ${BASE_ONION_ROUTER_PORT + nodeId}`);
  });

  return server;
}