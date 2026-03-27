import nacl from "tweetnacl";
import { decodeBase64, encodeUTF8 } from "tweetnacl-util";
import { getPrivateKey } from "./keys.js";

export function decryptFromSender(
  ciphertext: string,
  nonce: string,
  senderPublicKey: string,
): string | null {
  const privateKey = getPrivateKey();
  if (!privateKey) {
    return null;
  }

  try {
    const ciphertextBytes = decodeBase64(ciphertext);
    const nonceBytes = decodeBase64(nonce);
    const senderPk = decodeBase64(senderPublicKey);
    const recipientSk = decodeBase64(privateKey);

    const decrypted = nacl.box.open(
      ciphertextBytes,
      nonceBytes,
      senderPk,
      recipientSk,
    );

    if (!decrypted) return null;
    return encodeUTF8(decrypted);
  } catch {
    return null;
  }
}
