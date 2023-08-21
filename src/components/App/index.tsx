import { useEffect, useState } from "react";
import {
  Status,
  State,
  TaskState,
  Message,
} from "../../types/Status";
import { BiRefresh, BiCopy } from "react-icons/bi";
import { interval, Subject, takeUntil } from "rxjs";
import { Contract, Signer, ethers, providers, utils } from "ethers";
import { BrowserProvider, Wallet } from "ethers6";
import metamask from "../../assets/images/metamask.png";
import Header from "../Header";
import Switch from "react-switch";
import "./style.css";
import axios from "axios";
import Loading from "../Loading";
import Button from "../Button";
import { LocalStorage } from "../../session/storage/local-storage";
import { StorageKeys } from "../../session/storage/storage-keys";

import { v4 as uuidv4 } from "uuid";

import { sessionKeyAbi } from "../../assets/contracts/sessionAbi";
import { CallWithERC2771Request, GelatoRelay } from "@gelatonetwork/relay-sdk";

import { TempKey } from "../../session/TempKey";
import AccountAbstraction, {
  AccountAbstractionConfig,
  OperationType,
} from "@safe-global/account-abstraction-kit-poc";

import Safe, {
  EthersAdapter,
  getSafeContract,
} from "@safe-global/protocol-kit";

import { GelatoRelayPack } from "@safe-global/relay-kit";
import { counterAbi } from "../../assets/contracts/counterAbi";
import { Dropdown } from "react-dropdown-now";
import "react-dropdown-now/style.css";
import {
  MetaTransactionData,
  MetaTransactionOptions,
  RelayTransaction,

} from "@safe-global/safe-core-sdk-types";

import { Interface } from "ethers/lib/utils";

const App = () => {
  const GELATO_RELAY_API_KEY = "YOUR GELATO SPONSOR KEY";
  let destroyFetchTask: Subject<void> = new Subject();
  let txHash: string | undefined;
  const targetAddress = "0x87CA985c8F3e9b70bCCc25bb67Ae3e2F6f31F51C";
  const sessionKeyAddress = "0xEBF7dc15b153601DdA7594DC7bC42105c1E06844";
  const relay = new GelatoRelay();

  const localStorage = new LocalStorage();

  const [sessionKeyContract, setSessionKeyContract] = useState<Contract>();
  const [counterContract, setCounterContract] = useState<Contract>();

  const [ready, setReady] = useState(false);

  const [provider, setProvider] = useState<providers.Web3Provider | null>(null);
  const [signer, setSigner] = useState<Signer | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [message, setMessage] = useState<Message>({
    header: "Loading",
    body: undefined,
    taskId: undefined,
  });
  const [counter, setCounter] = useState<string>("Loading");
  const [safes, setSafes] = useState<string[]>([]);
  const [safe, setSafe] = useState<string | undefined>();
  const [signerAddress, setSignerAddress] = useState<string | null>(null);
  const [signLess, setSignLess] = useState<boolean>(false);

  const [connectStatus, setConnectStatus] = useState<Status | null>({
    state: State.missing,
    message: "Loading",
  });

  if (typeof window.ethereum != "undefined") {
    window.ethereum.on("accountsChanged", () => {
      const web3Provider = new providers.Web3Provider(window.ethereum);
      setLoading(true);
      refresh(web3Provider);
      localStorage.remove(StorageKeys.SESSION_ID);
      localStorage.remove(StorageKeys.SESSION_KEY);
    });

    window.ethereum.on("chainChanged", async () => {
      const web3Provider = new providers.Web3Provider(window.ethereum);
      setLoading(true);
      refresh(web3Provider);
      localStorage.remove(StorageKeys.SESSION_ID);
      localStorage.remove(StorageKeys.SESSION_KEY);
      const currentChainId = await window.ethereum.request({
        method: "eth_chainId",
      });

      if (currentChainId !== "0x5") {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x5" }],
        });
      }
    });
  }

  const onDisconnect = async () => {
    setConnectStatus({
      state: State.failed,
      message: "Waiting for Disconnection",
    });
    localStorage.remove(StorageKeys.SESSION_ID);
    localStorage.remove(StorageKeys.SESSION_KEY);
    await window.ethereum.request({
      method: "eth_requestAccounts",
      params: [
        {
          eth_accounts: {},
        },
      ],
    });
  };

  const onConnect = async () => {
    console.log("connec");
    try {
      await window.ethereum.request({
        method: "wallet_requestPermissions",
        params: [
          {
            eth_accounts: {},
          },
        ],
      });
      const web3Provider = new providers.Web3Provider(window.ethereum);
      setLoading(true);
      refresh(web3Provider);
      localStorage.remove(StorageKeys.SESSION_ID);
      localStorage.remove(StorageKeys.SESSION_KEY);
    } catch (error) {}
  };

  const onCopy = async (text: string) => {
    if ("clipboard" in navigator) {
      await navigator.clipboard.writeText(text);
    } else {
      document.execCommand("copy", true, text);
    }
    alert("Copied to Clipboard");
  };

  const onAction = async (action: number) => {
    switch (action) {
      case 0:
        console.log("trading");

        if (signLess) {
          tradeSignLess();
        } else {
          trade();
        }

        break;
      case 1:
        console.log("create Safe");
        await getSafeAddress();
        break;

      default:
        setLoading(false);
        break;
    }
  };

  const trade = async () => {
    try {
      setMessage({
        header: "Waiting for tx...",
        body: undefined,
        taskId: undefined,
      });
      setLoading(true);
      let tmpCountercontract = await getCounterContract(provider!);

      const { data: dataCounter } =
        await tmpCountercontract!.populateTransaction.increment();
      const txSpec = {
        to: "0x87CA985c8F3e9b70bCCc25bb67Ae3e2F6f31F51C",
        data: dataCounter!,
        value: "0",
        operation: 0,
      };

      let safeSDK: any;
      let ethAdapter: any;
      const relayKit = new GelatoRelayPack(GELATO_RELAY_API_KEY);

      try {
        ethAdapter = new EthersAdapter({
          ethers,
          signerOrProvider: signer!,
        });
        safeSDK = await Safe.create({
          ethAdapter,
          safeAddress: safe!,
        });
      } catch (error) {
        alert("Safe not yet deployed");
        console.log("safe not deployed");
      }
      const gasLimit = "10000000";
      const options: MetaTransactionOptions = {
        gasLimit,
        isSponsored: true,
      };
      const standardizedSafeTx = await relayKit.createRelayedTransaction(
        safeSDK!,
        [txSpec],
        options
      );

      const safeSingletonContract = await getSafeContract({
        ethAdapter: ethAdapter!,
        safeVersion: await safeSDK!.getContractVersion(),
      });

      const signedSafeTx = await safeSDK!.signTransaction(standardizedSafeTx);

      const encodedTx = safeSingletonContract.encode("execTransaction", [
        signedSafeTx.data.to,
        signedSafeTx.data.value,
        signedSafeTx.data.data,
        signedSafeTx.data.operation,
        signedSafeTx.data.safeTxGas,
        signedSafeTx.data.baseGas,
        signedSafeTx.data.gasPrice,
        signedSafeTx.data.gasToken,
        signedSafeTx.data.refundReceiver,
        signedSafeTx.encodedSignatures(),
      ]);

      const relayTransaction: RelayTransaction = {
        target: safe!,
        encodedTransaction: encodedTx,
        chainId: 5,
        options,
      };

      setMessage({
        header: "Creating New Session",
        body: "Relaying tx",
        taskId: undefined,
      });
      const response = await relayKit.relayTransaction(relayTransaction);

      setMessage({
        header: "Creating New Session",
        body: "Waiting for tx.",
        taskId: undefined,
      });
      console.log(
        `https://relay.gelato.digital/tasks/status/${response.taskId}`
      );
      fetchStatus(response.taskId);
    } catch (error) {
      console.log(error);
      setLoading(false);
    }
  };

  const tradeSignLess = async () => {
    setMessage({
      header: "Relaying the transaction",
      body: undefined,
      taskId: undefined,
    });
    setLoading(true);

    let tmpCountercontract = await getCounterContract(provider!);
    let tmpSessionKeyContract = await getSessionContract(provider!);
    const { data: dataCounter } =
      await tmpCountercontract!.populateTransaction.increment();

 

    const sessionId = localStorage.get(StorageKeys.SESSION_ID);
    const sessionKey = localStorage.get(StorageKeys.SESSION_KEY);

    const tempKey = new TempKey(sessionKey);

    console.log(sessionId);
    console.log(sessionKey);

    const txSpec = {
      to: "0x87CA985c8F3e9b70bCCc25bb67Ae3e2F6f31F51C",
      data: dataCounter,
      value: 0,
      operation: 0,
    };
 
    let { data: dataExecute } =
      await tmpSessionKeyContract!.populateTransaction.execute(sessionId, [
        txSpec,
      ]);

    // relay sdk already on ethers V6 while safe sdk requires ethers V5
    const localProvider = new BrowserProvider(window.ethereum);
    const signer = new Wallet(sessionKey as string, localProvider) as Wallet;

    const request: CallWithERC2771Request = {
      chainId: BigInt(5),
      target: sessionKeyAddress,
      data: dataExecute as string,
      user: tempKey.address as string,
    };

  

    const response = await relay.sponsoredCallERC2771(
      request,
      signer as Wallet,
      GELATO_RELAY_API_KEY as string
    );

    console.log(`https://relay.gelato.digital/tasks/status/${response.taskId}`);
    fetchStatus(response.taskId);
  };

  const fetchStatus = async (taskIdToQuery: string) => {
    console.log(taskIdToQuery);

    const numbers = interval(1000);

    const takeFourNumbers = numbers.pipe(takeUntil(destroyFetchTask));

    takeFourNumbers.subscribe(async (x) => {
      try {
        // let status = await relay.getTaskStatus(taskIdToQuery);
        const res = await axios.get(
          `https://relay.gelato.digital/tasks/status/${taskIdToQuery}`
        );

        let status = res.data.task;

        let details = {
          txHash: status?.transactionHash || undefined,
          chainId: status?.chainId?.toString() || undefined,
          blockNumber: status?.blockNumber?.toString() || undefined,
          executionDate: status?.executionDate || undefined,
          creationnDate: status?.creationDate || undefined,
          taskState: (status?.taskState as TaskState) || undefined,
        };
        let body = ``;
        let header = ``;

        txHash = details.txHash;
        console.log(204, details.taskState);

        switch (details.taskState!) {
          case TaskState.WaitingForConfirmation:
            header = `Transaction Relayed`;
            body = `Waiting for Confirmation`;
            break;
          case TaskState.Pending:
            header = `Transaction Relayed`;
            body = `Pending Status`;

            break;
          case TaskState.CheckPending:
            header = `Transaction Relayed`;
            body = `Simulating Transaction`;

            break;
          case TaskState.ExecPending:
            header = `Transaction Relayed`;
            body = `Pending Execution`;
            break;
          case TaskState.ExecSuccess:
            header = `Transaction Executed`;
            body = `Waiting to refresh...`;

            // await this.getTokenId();

            //this.store.dispatch(Web3Actions.chainBusy({ status: false }));

            destroyFetchTask.next();
            setTimeout(() => {
              doRefresh();
            }, 2000);

            break;
          case TaskState.Cancelled:
            header = `Canceled`;
            body = `TxHash: ${details.txHash}`;
            destroyFetchTask.next();
            break;
          case TaskState.ExecReverted:
            header = `Reverted`;
            body = `TxHash: ${details.txHash}`;
            destroyFetchTask.next();
            break;
          case TaskState.NotFound:
            header = `Not Found`;
            body = `TxHash: ${details.txHash}`;
            destroyFetchTask.next();
            break;
          case TaskState.Blacklisted:
            header = `BlackListed`;
            body = `TxHash: ${details.txHash}`;
            destroyFetchTask.next();
            break;
          default:
            // ExecSuccess = "ExecSuccess",
            // ExecReverted = "ExecReverted",
            // Blacklisted = "Blacklisted",
            // Cancelled = "Cancelled",
            // NotFound = "NotFound",
            // destroyFetchTask.next();
            break;
        }

        setMessage({
          header,
          body,
          taskId: txHash,
        });
      } catch (error) {
        console.log(error);
      }
    });
  };

  const doRefresh = async () => {
    setMessage({
      header: "Checking Safes....",
      body: undefined,
      taskId: undefined,
    });
    setLoading(true);
    await refresh(provider!);
  };

  const refresh = async (provider: providers.Web3Provider) => {
    setProvider(provider);

    const addresses = await provider.listAccounts();

    if (addresses.length > 0) {
      const signer = await provider?.getSigner();
      const signerAddress = (await signer?.getAddress()) as string;
      setSignerAddress(signerAddress);
      setSigner(signer);
      setConnectStatus({
        state: State.success,
        message: "Connection Succeed",
      });

      getSafes(provider, signerAddress);

      setLoading(false);
    } else {
      setLoading(false);
      setConnectStatus({ state: State.failed, message: "Connection Failed" });
    }

    //
    // console.log(signer);
  };

  const getSessionContract = async (provider: providers.Web3Provider) => {
    if (sessionKeyContract == undefined) {
      const _sessionKeyContract = new Contract(
        sessionKeyAddress,
        sessionKeyAbi,
        provider
      );

      setSessionKeyContract(_sessionKeyContract);
      return _sessionKeyContract;
    } else {
      return sessionKeyContract;
    }
  };

  const getCounterContract = async (provider: providers.Web3Provider) => {
    if (counterContract == undefined) {
      const signer = await provider?.getSigner();
      const counterAddress = "0x87CA985c8F3e9b70bCCc25bb67Ae3e2F6f31F51C";
      const _counterContract = new Contract(counterAddress, counterAbi, signer);

      setCounterContract(counterContract);
      return _counterContract;
    } else {
      return counterContract;
    }
  };

  const getSession = async (provider: providers.Web3Provider) => {
    const contract = await getSessionContract(provider);

    const sessionId = localStorage.get(StorageKeys.SESSION_ID);

    const packed = utils.solidityPack(["string"], [sessionId]);
    const hash = utils.keccak256(packed);

    const session = await contract.sessions(hash);

    return session;
  };

  const changeSafe = async (value: any) => {
    console.log(value);
    setSafe(value.value);
    getCounter(provider!, value.value);

    startSignLess(value.value);
  };

  const getSafeAddress = async () => {
    setMessage({
      header: "Calculating Address",
      body: "Waiting....",
      taskId: undefined,
    });
    setLoading(true);
    const relayPack = new GelatoRelayPack(GELATO_RELAY_API_KEY);
    const safeAccountAbstraction = new AccountAbstraction(signer!);
    const sdkConfig: AccountAbstractionConfig = {
      relayPack,
    };
    await safeAccountAbstraction.init(sdkConfig);

    const safeAddress = await safeAccountAbstraction.getSafeAddress();
    const isDeployed = await safeAccountAbstraction.isSafeDeployed();

    console.log(safeAddress, isDeployed);
    setSafes([safeAddress]);
    setSafe(safeAddress);
    setLoading(false);
  };

  const getSafes = async (
    provider: providers.Web3Provider,
    signerAddress: string
  ) => {
    let safesAPI = `https://safe-transaction-goerli.safe.global/api/v1/owners/${signerAddress}/safes/`;
    const res = await axios.get(safesAPI);
    const safes = res.data.safes;
    if (safes.length > 0) {
      setSafes(safes);
      setSafe(safes[0]);
      console.log(safes[0]);
      getCounter(provider, safes[0]);
    } else {
      setSafes([]);
      setSafe(undefined);
      setCounter("0");
    }
  };

  const getCounter = async (
    provider: providers.Web3Provider,
    safeAddress: string
  ) => {
    const contract = await getCounterContract(provider);

    const balance = await contract.counter(safeAddress);

    setCounter(balance.toString());
  };

  const signToggle = async () => {
    setSignLess(!signLess);
    if (!signLess) {
      startSignLess(safe!);
    }
  };

  const startSignLess = async (_safe: string) => {
    setMessage({
      header: "Cheking Keys",
      body: "Retrieving new Session Key...",
      taskId: undefined,
    });
    setLoading(true);

    let transactionsArray = [];

    // creating Session Keys

    const localStorage = new LocalStorage();
    let _sessionId = localStorage.get(StorageKeys.SESSION_ID);
    let _sessionKey = localStorage.get(StorageKeys.SESSION_KEY);
    console.log(_sessionId, _sessionKey);

    if (_sessionId == null || _sessionKey == null) {
      createSessionKeys(safe!);
    } else {
      const session = await getSession(provider!);
      const tempKey = new TempKey(_sessionKey);
      const tempAddress = tempKey.address;
      console.log(session);

      const timestamp = Math.floor(Date.now() / 1000);

      if (
        tempAddress !== session.tempPublicKey ||
        timestamp > +session.end.toString() ||
        safe !== session.user
      ) {
        console.log("SESSION KEYS");
        setMessage({
          header: "Session Key Invalid",
          body: "Creating new Session Key...",
          taskId: undefined,
        });
        setTimeout(() => {
          createSessionKeys(safe!);
        }, 1000);
      } else {
        setLoading(false);
      }
    }
  };

  const createSessionKeys = async (_safe: string) => {
    console.log("CREATING NEW TMPKEY");

    let transactionsArray = [];

    let isDeployed;
    let isEnabled;

    // Checking if the module is enabled
    try {
      const safeContract = new Contract(
        _safe,
        [
          "function enableModule(address module) external",
          "function isModuleEnabled(address module) external view returns (bool)",
        ],
        signer!
      );

      isEnabled = await safeContract.isModuleEnabled(sessionKeyAddress);
      isDeployed = true;
    } catch (error) {
      console.log("safe not deployed");
      isDeployed = false;
      isEnabled = false;
    }

    console.log("Is module enabled: ", isEnabled);

    let tmpCounterContract = await getCounterContract(provider!);
    let tmpSessionContract = await getSessionContract(provider!);
    const funcSig = tmpCounterContract.interface.getSighash("increment()");

    const txSpec = {
      to: "0x87CA985c8F3e9b70bCCc25bb67Ae3e2F6f31F51C",
      selector: funcSig,
      hasValue: false,
      operation: 0,
    };

    const isWhitelisted = await tmpSessionContract.isWhitelistedTransaction(
      _safe,
      [txSpec]
    );

    console.log("is whitelisted: ", isWhitelisted);

    setMessage({
      header: "Creating New Session",
      body: "Preparing tx...",
      taskId: undefined,
    });

    const safeIface = new Interface([
      "function enableModule(address module) external",
      "function isModuleEnabled(address module) external view returns (bool)",
    ]);

    //// Preparing the transactions with the safe-sdk
    if (isEnabled == false) {
      //// Enabling module
      const safeTransactionDataModule: MetaTransactionData = {
        to: _safe,
        data: safeIface.encodeFunctionData("enableModule", [
          "0xEBF7dc15b153601DdA7594DC7bC42105c1E06844",
        ]),
        value: "0",
        operation: OperationType.Call,
      };

      transactionsArray.push(safeTransactionDataModule);
    }

    if (isWhitelisted == false) {
      /// whitelist transaction
      // const iface = new ethers.utils.Interface(counterAbi);
   
      const safeTransactionDataWhitelist: MetaTransactionData = {
        to: sessionKeyAddress,
        data: tmpSessionContract.interface.encodeFunctionData(
          "whitelistTransaction",
          [[txSpec]]
        ),
        value: "0",
        operation: OperationType.Call,
      };
      transactionsArray.push(safeTransactionDataWhitelist);
    }

    //// Creatgin session
    const tempKey = new TempKey();
    console.log(tempKey.privateKey);
    const tempAddress = tempKey.address;

    const sessionId = uuidv4();
    console.log(sessionId, tempAddress);
    const safeTransactionDataCreation: MetaTransactionData = {
      to: sessionKeyAddress,
      data: tmpSessionContract.interface.encodeFunctionData("createSession", [
        sessionId,
        3600,
        tempAddress,
      ]),
      value: "0",
      operation: OperationType.Call,
    };

    transactionsArray.push(safeTransactionDataCreation);

    // Generate the target payload

    localStorage.save(StorageKeys.SESSION_ID, sessionId);
    localStorage.save(StorageKeys.SESSION_KEY, tempKey.privateKey);

    console.log(sessionId, tempAddress);

    ///// RELAYING TRANSACTIONS

    const relayKit = new GelatoRelayPack(GELATO_RELAY_API_KEY);

    const ethAdapter = new EthersAdapter({
      ethers,
      signerOrProvider: signer!,
    });

    let safeSDK: Safe;
    const gasLimit = "10000000";
    const options: MetaTransactionOptions = {
      gasLimit,
      isSponsored: true,
    };
     
    if (isDeployed) {
      //// Preparing the transactions with the safe-sdk
      safeSDK = await Safe.create({
        ethAdapter,
        safeAddress: _safe,
      });

      const standardizedSafeTx = await relayKit.createRelayedTransaction(
        safeSDK,
        transactionsArray,
        options
      );

      const safeSingletonContract = await getSafeContract({
        ethAdapter: ethAdapter,
        safeVersion: await safeSDK.getContractVersion(),
      });

      const signedSafeTx = await safeSDK.signTransaction(standardizedSafeTx);

      const encodedTx = safeSingletonContract.encode("execTransaction", [
        signedSafeTx.data.to,
        signedSafeTx.data.value,
        signedSafeTx.data.data,
        signedSafeTx.data.operation,
        signedSafeTx.data.safeTxGas,
        signedSafeTx.data.baseGas,
        signedSafeTx.data.gasPrice,
        signedSafeTx.data.gasToken,
        signedSafeTx.data.refundReceiver,
        signedSafeTx.encodedSignatures(),
      ]);

      const relayTransaction: RelayTransaction = {
        target: _safe,
        encodedTransaction: encodedTx,
        chainId: 5,
        options,
      };

      setMessage({
        header: "Creating New Session",
        body: "Relaying tx",
        taskId: undefined,
      });
      const response = await relayKit.relayTransaction(relayTransaction);

      setMessage({
        header: "Creating New Session",
        body: "Waiting for tx.",
        taskId: undefined,
      });
      console.log(
        `https://relay.gelato.digital/tasks/status/${response.taskId}`
      );
      fetchStatus(response.taskId);
    } else {
       //// Preparing the transactions with the safe-sdk
      const relayPack = new GelatoRelayPack(GELATO_RELAY_API_KEY);
      const safeAccountAbstraction = new AccountAbstraction(signer!);
      const sdkConfig: AccountAbstractionConfig = {
        relayPack,
      };
      await safeAccountAbstraction.init(sdkConfig);
      const response = await safeAccountAbstraction.relayTransaction(
        transactionsArray,
        options
      );
      console.log(`https://relay.gelato.digital/tasks/status/${response} `);
      fetchStatus(response);
    }
  };

  useEffect(() => {
    (async () => {
      if (provider != null) {
        return;
      }
      if (window.ethereum == undefined) {
        setLoading(false);
      } else {
        const currentChainId = await window.ethereum.request({
          method: "eth_chainId",
        });

        if (currentChainId !== "0x5") {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x5" }],
          });
        }
        const web3Provider = new providers.Web3Provider(window.ethereum);
        refresh(web3Provider);
      }
    })();
  }, []);

  return (
    <div className="App">
      <div className="container">
        <Header
          status={connectStatus}
          ready={ready}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          signerAddress={signerAddress}
        />
        {connectStatus?.state! == State.success && (
          <div>
            {loading && <Loading message={message} />}
            <main>
              <div className="flex">
                <p className="title">Trade Signless</p>
                <div className="isDeployed">
                  <p>User:</p>
                  <p className="highlight">
                    {signerAddress}
                    <span
                      style={{ position: "relative", top: "5px", left: "5px" }}
                    >
                      <BiCopy
                        cursor={"pointer"}
                        color="white"
                        fontSize={"20px"}
                        onClick={() => onCopy(signerAddress!)}
                      />
                    </span>
                  </p>
                  {safes.length > 0 ? (
                    <div style={{ width: "350px", margin: "25px auto 10px" }}>
                      <p style={{ fontWeight: "600" }}>Safes owned</p>
                      <Dropdown
                        className="drop"
                        placeholder="Select your safe"
                        options={safes}
                        value={safes[0]}
                        onSelect={(value) => changeSafe(value as string)}
                      />
                    </div>
                  ) : (
                    <div>
                      <p style={{ fontWeight: "600" }}>
                        No safes associated to this user
                      </p>
                      <Button ready={ready} onClick={() => onAction(1)}>
                        {" "}
                        Get Safe Address
                      </Button>
                    </div>
                  )}
                  {safe != undefined && (
                    <div>
                      <p style={{ fontWeight: "600" }}>
                        Counter:
                        <span
                          style={{ marginLeft: "10px", fontSize: "15px" }}
                          className="highlight"
                        >
                          {counter}
                          <span style={{ position: "relative", top: "5px" }}>
                            <BiRefresh
                              color="white"
                              cursor={"pointer"}
                              fontSize={"20px"}
                              onClick={doRefresh}
                            />
                          </span>
                        </span>
                      </p>
                      <Button ready={ready} onClick={() => onAction(0)}>
                        {" "}
                        Trade
                      </Button>
                      <div style={{ marginTop: "10px" }}>
                        {" "}
                        <span style={{ position: "relative", bottom: "9px" }}>
                          {" "}
                          Signless:{" "}
                        </span>
                        <Switch onChange={signToggle} checked={signLess} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </main>
          </div>
        )}{" "}
        {connectStatus?.state! == State.missing && (
          <p style={{ textAlign: "center" }}>Metamask not Found</p>
        )}
        {(connectStatus?.state == State.pending ||
          connectStatus?.state == State.failed) && (
          <div style={{ textAlign: "center", marginTop: "20px" }}>
            <h3> Please connect your metamask</h3>
            <Button status={connectStatus} ready={ready} onClick={onConnect}>
              <img src={metamask} width={25} height={25} />{" "}
              <span style={{ position: "relative", top: "-6px" }}>
                Connect{" "}
              </span>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
