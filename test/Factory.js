const { BigNumber } = require("@ethersproject/bignumber");
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { beforeEach } = require("mocha");

async function balance(address) {
  return await ethers.provider.getBalance(address);
}

describe("Factory", function () {
  let factoryContract;
  let revShare;
  let uri = "ipfs://";

  beforeEach(async () => {
    [owner, address1, address2, address3, feeHandler] =
      await ethers.getSigners();
    const FactoryContract = await ethers.getContractFactory(
      "Factory"
    );

    const RevShare = await ethers.getContractFactory("RevShare");

    revShare = await RevShare.connect(owner).deploy();

    factoryContract = await FactoryContract.connect(owner).deploy(
      "My Track",
      "TUNE",
      uri
    );

    await factoryContract
      .connect(owner)
      .setApprovedRevShareContract(revShare.address);
  });

  it("should add revShare contract as deposit manager", async () => {
    expect(await factoryContract.approvedRevShareContract()).to.equal(
      revShare.address
    );
  });

  it("should increase totalSupply of tokens", async () => {
    await factoryContract.mint();
    expect(await factoryContract.totalSupply()).to.equal(1);
  });

  it("should deposit ETH into contract", async () => {
    const value = ethers.utils.parseEther("1");

    await factoryContract
      .connect(address1)
      ["deposit(address)"](revShare.address, { value });

    const contractBalance = await factoryContract.provider.getBalance(
      factoryContract.address
    );

    expect(contractBalance).to.equal(value);
  });

  it("send correct amount via payment splitter", async () => {
    const value = ethers.utils.parseEther("1");
    // send some ETH to contract from address1
    address1.sendTransaction({
      to: factoryContract.address,
      value,
    });

    // mint NFT
    await factoryContract.connect(address1).mint();

    // deposit some ETH via deposit() function
    await factoryContract
      .connect(address1)
      ["deposit(address)"](revShare.address, { value });

    // released funds into owner account
    const contractBalance = await factoryContract.provider.getBalance(
      factoryContract.address
    );
    await factoryContract
      .connect(address1)
      ["release(address)"](owner.address);

    // check correct amount has been released
    const newContractBalance =
      await factoryContract.provider.getBalance(
        factoryContract.address
      );

    expect(newContractBalance).to.equal(
      BigNumber.from(contractBalance).sub(
        BigNumber.from(value).div(100).mul(100)
      )
    );
  });

  it("send correct amount via payment splitter 2", async () => {
    const value = ethers.utils.parseEther("0.43546743566");
    const value2 = ethers.utils.parseEther("4.3564");

    // allocate 40% from owner => address1
    await factoryContract
      .connect(owner)
      .allocateShares(address1.address, 40);

    // allocate 20% from address1 => address2
    await factoryContract
      .connect(address1)
      .allocateShares(address2.address, 20);

    // send some ETH directly to the contract
    await address1.sendTransaction({
      to: factoryContract.address,
      value,
    });

    // mint 4 NFTs
    await factoryContract.connect(owner).mint(); // 1ETH
    await factoryContract.connect(address1).mint(); // 1ETH
    await factoryContract.connect(address1).mint(); // 1ETH
    await factoryContract.connect(address1).mint(); // 1ETH

    // deposit some ETH via deposit() function
    await factoryContract
      .connect(address1)
      ["deposit(address)"](revShare.address, { value: value2 });

    const contractBalance = await balance(factoryContract.address);

    // withdraw revShare for token id 2;
    await factoryContract["withdraw(address,uint256)"](
      revShare.address,
      2
    );

    // released funds into owner wallet
    await factoryContract
      .connect(owner)
      ["release(address)"](address1.address);

    // withdraw revShare for token id 0;
    await factoryContract["withdraw(address,uint256)"](
      revShare.address,
      0
    );

    // release funds into address1 wallet
    await factoryContract["release(address)"](owner.address);

    // withdraw revShare for token id 1;
    await factoryContract["withdraw(address,uint256)"](
      revShare.address,
      1
    );

    // check correct amount has been released
    const newContractBalance = await balance(factoryContract.address);

    expect(newContractBalance).to.equal(
      BigNumber.from(contractBalance)
        .sub(BigNumber.from(value).div(100).mul(20))
        .sub(BigNumber.from(value2.div(4)))
        .sub(BigNumber.from(value).div(100).mul(60))
        .sub(BigNumber.from(value2.div(4)))
        .sub(BigNumber.from(value2.div(4)))
    );
  });

  describe("PaymentSplitter", function () {
    let factoryContract;
    let revShare;
    let uri = "ipfs://";
    const value = ethers.utils.parseEther("1");
    const value2 = ethers.utils.parseEther("4");

    beforeEach(async () => {
      [owner, address1, address2, address3, feeHandler] =
        await ethers.getSigners();
      const FactoryContract = await ethers.getContractFactory(
        "Factory"
      );

      const RevShare = await ethers.getContractFactory("RevShare");

      revShare = await RevShare.connect(owner).deploy();

      factoryContract = await FactoryContract.connect(owner).deploy(
        "My Track",
        "TUNE",
        uri
      );

      await factoryContract
        .connect(owner)
        .setApprovedRevShareContract(revShare.address);

      // Deploy token contract
      const ERC20Token = await ethers.getContractFactory("Token");
      erc20 = await ERC20Token.connect(address1).deploy();

      // mint 4 NFTs
      await factoryContract.connect(owner).mint(); // 1ETH
      await factoryContract.connect(address1).mint(); // 1ETH
      await factoryContract.connect(address1).mint(); // 1ETH
      await factoryContract.connect(address1).mint(); // 1ETH

      // Send ERC20 directly to contract
      await erc20
        .connect(address1)
        .transfer(factoryContract.address, value);

      // approve
      await erc20
        .connect(address1)
        .approve(factoryContract.address, value2);

      // deposit some ETH via deposit() function
      await factoryContract
        .connect(address1)
        ["deposit(address,address,uint256)"](
          revShare.address,
          erc20.address,
          value2
        );

      // allocate 50% from owner => address1
      await factoryContract
        .connect(owner)
        .allocateShares(address1.address, 50);
    });

    it("should increase the ERC20 balance of the contract when depositing", async () => {
      expect(await erc20.balanceOf(factoryContract.address)).to.equal(
        BigNumber.from(value).add(value2)
      );
    });

    it("should withdraw tokens to allocated payees", async () => {
      const address1Balance = await erc20.balanceOf(address1.address);

      // release funds into address1 wallet
      await factoryContract["release(address,address)"](
        erc20.address,
        address1.address
      );

      const newAddress1Balance = await erc20.balanceOf(
        address1.address
      );

      expect(newAddress1Balance).to.be.equal(
        BigNumber.from(address1Balance).add(
          BigNumber.from(value).div(2)
        )
      );
    });

    it("should correctly withdraw ERC20 balance to NFT holders", async () => {
      const contractBalance = await erc20.balanceOf(
        factoryContract.address
      );

      // withdraw revShare for token id 1;
      await factoryContract["withdraw(address,address,uint256)"](
        erc20.address,
        revShare.address,
        0
      );

      // withdraw revShare for token id 1;
      await factoryContract["withdraw(address,address,uint256)"](
        erc20.address,
        revShare.address,
        1
      );
      // withdraw revShare for token id 2;
      await factoryContract["withdraw(address,address,uint256)"](
        erc20.address,
        revShare.address,
        2
      );
      // withdraw revShare for token id 3;
      await factoryContract["withdraw(address,address,uint256)"](
        erc20.address,
        revShare.address,
        3
      );

      // release funds into owner wallet
      await factoryContract["release(address,address)"](
        erc20.address,
        owner.address
      );

      // release funds into address1 wallet
      await factoryContract["release(address,address)"](
        erc20.address,
        address1.address
      );

      const newContractBalance = await erc20.balanceOf(
        factoryContract.address
      );

      expect(newContractBalance).to.be.equal(
        BigNumber.from(contractBalance).sub(value).sub(value2)
      );
    });

    it("should correctly release all ERC20 tokens", async () => {
      const address1Balance = await erc20.balanceOf(address1.address);

      // withdraw revShare for token id 1;
      await factoryContract["withdraw(address,address,uint256)"](
        erc20.address,
        revShare.address,
        1
      );
      // withdraw revShare for token id 2;
      await factoryContract["withdraw(address,address,uint256)"](
        erc20.address,
        revShare.address,
        2
      );
      // withdraw revShare for token id 3;
      await factoryContract["withdraw(address,address,uint256)"](
        erc20.address,
        revShare.address,
        3
      );

      const newAddress1Balance = await erc20.balanceOf(
        address1.address
      );

      expect(newAddress1Balance).to.be.equal(
        BigNumber.from(address1Balance).add(
          BigNumber.from(value2).div(4).mul(3)
        )
      );
    });
  });
  it("send deposit and withdraw the correct amount of ERC20 tokens", async () => {
    // Deploy token contract
    const ERC20Token = await ethers.getContractFactory("Token");
    erc20 = await ERC20Token.connect(address1).deploy();

    // Deposit values
    const value = ethers.utils.parseEther("1");
    const value2 = ethers.utils.parseEther("4");

    // approve
    await erc20
      .connect(address1)
      .approve(factoryContract.address, value2);

    // allocate 40% from owner => address1
    await factoryContract
      .connect(owner)
      .allocateShares(address1.address, 40);

    // allocate 20% from address1 => address2
    await factoryContract
      .connect(address1)
      .allocateShares(address2.address, 20);

    // send some ERC20 directly to the contract
    await erc20
      .connect(address1)
      .transfer(factoryContract.address, value);

    // mint 4 NFTs
    await factoryContract.connect(owner).mint(); // 1ETH
    await factoryContract.connect(address1).mint(); // 1ETH
    await factoryContract.connect(address1).mint(); // 1ETH
    await factoryContract.connect(address1).mint(); // 1ETH

    // deposit some ETH via deposit() function
    await factoryContract
      .connect(address1)
      ["deposit(address,address,uint256)"](
        revShare.address,
        erc20.address,
        value2
      );

    const contractBalance = await erc20.balanceOf(
      factoryContract.address
    );

    // withdraw revShare for token id 2;
    await factoryContract["withdraw(address,address,uint256)"](
      erc20.address,
      revShare.address,
      2
    );

    // released funds into owner wallet
    await factoryContract
      .connect(owner)
      ["release(address,address)"](erc20.address, address1.address);

    // withdraw revShare for token id 0;
    await factoryContract["withdraw(address,address,uint256)"](
      erc20.address,
      revShare.address,
      0
    );

    // release funds into address1 wallet
    await factoryContract["release(address,address)"](
      erc20.address,
      owner.address
    );

    // withdraw revShare for token id 1;
    await factoryContract["withdraw(address,address,uint256)"](
      erc20.address,
      revShare.address,
      1
    );

    // check correct amount has been released
    const newContractBalance = await erc20.balanceOf(
      factoryContract.address
    );

    expect(newContractBalance).to.equal(
      BigNumber.from(contractBalance)
        .sub(BigNumber.from(value).div(100).mul(20))
        .sub(BigNumber.from(value2.div(4)))
        .sub(BigNumber.from(value).div(100).mul(60))
        .sub(BigNumber.from(value2.div(4)))
        .sub(BigNumber.from(value2.div(4)))
    );
  });

  it("should allocate owner shares to other accounts", async () => {
    await factoryContract
      .connect(owner)
      .allocateShares(address1.address, 20);

    await factoryContract
      .connect(owner)
      .allocateShares(address2.address, 25);

    await factoryContract
      .connect(owner)
      .allocateShares(address3.address, 45);

    expect(await factoryContract.shares(owner.address)).to.equal(10);
  });

  it("should prevent over allocation of shares", async () => {
    await expect(
      factoryContract
        .connect(owner)
        .allocateShares(address1.address, 101)
    ).to.be.revertedWith("You dont have enough shares to give away");
  });
});