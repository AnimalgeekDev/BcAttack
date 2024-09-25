// walletChecker.js
const mongoose = require("mongoose");
const bip39 = require("bip39");
const bitcoin = require("bitcoinjs-lib");
const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");
const HDKey = require("hdkey");
const CoinKey = require("coinkey");

// Conexión a MongoDB
mongoose.connect("mongodb://localhost:27017/walletChecker", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Definición del esquema y modelo de MongoDB
const walletSchema = new mongoose.Schema({
  words: [String],
  walletHash: String,
  balance: Number,
});

const MgWalletWithBalance = mongoose.model("WalletWithBalance", walletSchema);
const MgWalletNoBalance = mongoose.model("WalletNoBalance", walletSchema);

// Cargar diccionario de palabras desde un archivo .json
let dictionary = [];
function loadDictionary() {
  console.log("Cargando diccionario...");
  return fs
    .readFile(path.join(__dirname, "../words_dictionary.json"), "utf8")
    .then((data) => {
      dictionary = JSON.parse(data);
      console.log(`Carga completa de las palabras: ${dictionary.length}`);
    });
}

// Función para obtener 12 palabras aleatorias y únicas
function getRandomWords() {
  const words = [];
  while (words.length < 12) {
    const word = dictionary[Math.floor(Math.random() * dictionary.length)];
    if (!words.includes(word)) {
      words.push(word);
    }
  }
  return words;
}

// Función principal para verificar la wallet
function checkWallet() {
  const words = getRandomWords();
  const mnemonic = words.join(" ");
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const hdKey = HDKey.fromMasterSeed(Buffer.from(seed, "hex"));
  const path = "m/44'/0'/0'/0/0";
  const child = hdKey.derive(path);
  const coinKey = new CoinKey(child.privateKey, bitcoin.networks.bitcoin);

  const address = coinKey.publicAddress;

  // Usar una API pública para obtener el saldo de la wallet de Bitcoin
  return axios
    .get(`https://blockchain.info/q/addressbalance/${address}`)
    .then((response) => {
      const balance = response.data / 1e8; // Convertir satoshis a BTC

      const walletData = {
        words: words,
        walletHash: address,
        balance: balance,
      };

      if (walletData.balance > 0) {
        return MgWalletWithBalance.create(walletData);
      } else {
        return MgWalletNoBalance.create({ ...walletData, balance: 0 });
      }
    })
    .then(() => {
      console.log(walletData.walletHash);
    })
    .catch((err) => {
      if (err.response && err.response.status === 429) {
        const retryAfter =
          parseInt(err.response.headers["retry-after"], 10) * 1000;
        console.error(
          `Rate limit exceeded. Retrying after ${retryAfter / 1000} seconds.`
        );
        return new Promise((resolve) => setTimeout(resolve, retryAfter)).then(
          checkWallet
        );
      } else {
        console.error(err);
      }
    });
}

// Ejecutar múltiples verificaciones de wallets continuamente
function main() {
  loadDictionary()
    .then(() => {
      function executeChecks() {
        const promises = Array.from({ length: 10 }, () => checkWallet());
        Promise.all(promises)
          .then(() => {
            setTimeout(executeChecks, 1000); // Esperar 1 segundo antes de la siguiente ronda de peticiones
          })
          .catch((err) => {
            console.error(err);
          });
      }
      executeChecks();
    })
    .catch((err) => {
      console.error(err);
      mongoose.connection.close();
    });
}

// Manejar señales del sistema para cerrar la conexión a MongoDB adecuadamente
process.on("SIGINT", () => {
  console.log("Proceso interrumpido. Cerrando conexión a MongoDB...");
  mongoose.connection.close(() => {
    console.log("Conexión a MongoDB cerrada.");
    process.exit(0);
  });
});

main();
