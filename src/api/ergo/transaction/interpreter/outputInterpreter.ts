import { ERG_DECIMALS, ERG_TOKEN_ID } from "@/constants/ergo";
import { ErgoBoxCandidate, UnsignedInput } from "@/types/connector";
import { decimalize, toBigNumber } from "@/utils/bigNumbers";
import BigNumber from "bignumber.js";
import { find, findIndex, first, isEmpty } from "lodash";
import { addressFromErgoTree } from "@/api/ergo/addresses";
import { decodeColl } from "@/api/ergo/sigmaSerializer";
import { StateAssetInfo } from "@/types/internal";
import { isBabelErgoTree } from "../../babelFees";

export type OutputAsset = {
  tokenId: string;
  name?: string;
  amount: BigNumber;
  decimals?: number;
  description?: string;
  minting?: boolean;
};

export class OutputInterpreter {
  private _box!: ErgoBoxCandidate;
  private _inputs!: UnsignedInput[];
  private _assets!: OutputAsset[];
  private _assetInfo!: StateAssetInfo;
  private _addresses?: string[];

  public get receiver(): string {
    return addressFromErgoTree(this._box.ergoTree);
  }

  public get assets(): OutputAsset[] {
    return this._assets;
  }

  public get isIntrawallet(): boolean {
    return this._addresses?.includes(this.receiver) ?? false;
  }

  public get isMinting(): boolean {
    return find(this._assets, (a) => a.minting) !== undefined;
  }

  public get isBabelBoxSwap(): boolean {
    return (
      isBabelErgoTree(this._box.ergoTree) &&
      this._inputs.find((input) => input.ergoTree === this._box.ergoTree) !== undefined
    );
  }

  constructor(
    boxCandidate: ErgoBoxCandidate,
    inputs: UnsignedInput[],
    assetInfo: StateAssetInfo,
    addresses?: string[]
  ) {
    this._box = boxCandidate;
    this._inputs = inputs;
    this._assetInfo = assetInfo;
    this._addresses = addresses;
    this._assets = this.isBabelBoxSwap
      ? this.buildBabelSwapAssetsList()
      : this.buildSendingAssetsList();
  }

  private buildBabelSwapAssetsList(): OutputAsset[] {
    const input = this._inputs.find((input) => input.ergoTree === this._box.ergoTree);
    if (!input) {
      return this.buildSendingAssetsList();
    }

    const assets = this._box.assets.map((token) => {
      const inputValue = input.assets.find((asset) => asset.tokenId === token.tokenId)?.amount || 0;

      return {
        tokenId: token.tokenId,
        name: this._assetInfo[token.tokenId]?.name,
        amount: decimalize(
          toBigNumber(token.amount).minus(inputValue),
          this._assetInfo[token.tokenId].decimals || 0
        )
      } as OutputAsset;
    });

    assets.push({
      tokenId: ERG_TOKEN_ID,
      name: "ERG",
      amount: decimalize(toBigNumber(input.value).minus(this._box.value), ERG_DECIMALS)
    });

    return assets;
  }

  private buildSendingAssetsList(): OutputAsset[] {
    const assets = [] as OutputAsset[];
    assets.push({
      tokenId: ERG_TOKEN_ID,
      name: "ERG",
      amount: decimalize(toBigNumber(this._box.value), ERG_DECIMALS)
    });

    if (isEmpty(this._box.assets)) {
      return assets;
    }

    const tokens = this._box.assets.map((t) => {
      return {
        tokenId: t.tokenId,
        name: this._assetInfo[t.tokenId]?.name,
        amount: this._assetInfo[t.tokenId]?.decimals
          ? decimalize(toBigNumber(t.amount), this._assetInfo[t.tokenId].decimals || 0)
          : toBigNumber(t.amount)
      } as OutputAsset;
    });

    const minting = this.getMintingToken();
    if (minting) {
      const index = findIndex(tokens, (t) => t.tokenId === minting.tokenId);
      if (index > -1) {
        tokens[index] = minting;
      }
    }

    return assets.concat(tokens);
  }

  private getMintingToken(): OutputAsset | undefined {
    const firstInputId = first(this._inputs)?.boxId;
    if (!firstInputId) {
      return undefined;
    }

    const token = find(this._box.assets, (b) => b.tokenId === firstInputId);
    if (!token) {
      return undefined;
    }

    if (isEmpty(this._box.additionalRegisters)) {
      return {
        tokenId: token.tokenId,
        amount: toBigNumber(token.amount)!
      };
    }

    const decimals = parseInt(decodeColl(this._box.additionalRegisters["R6"]) ?? "");
    return {
      tokenId: token.tokenId,
      name: decodeColl(this._box.additionalRegisters["R4"]) ?? "",
      decimals,
      amount: decimals
        ? decimalize(toBigNumber(token.amount)!, decimals)
        : toBigNumber(token.amount)!,
      description: decodeColl(this._box.additionalRegisters["R5"]) ?? "",
      minting: true
    };
  }
}
