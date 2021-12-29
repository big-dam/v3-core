const { expect } = require('chai')
const { encodePriceSqrt, MIN_SQRT_RATIO, MAX_SQRT_RATIO } = require('./shared/utilities')

describe('Test Liquidity Bug', async function() {
  let pool, router
  // tick1 < tickInit < tick3 < tick4, tick1 < tick2 < tick3
  let tick1, tick2, tick3, tick4, tickInit
  let priceLimit2, priceLimit3, priceLimit4
  let owner
  let liquidity = ethers.utils.parseEther('100')
  it('init', async function() {
    [owner] = await ethers.getSigners()
    let Factory = await ethers.getContractFactory('UniswapV3Factory')
    let factory = await Factory.deploy()
    let TestERC20 = await ethers.getContractFactory('TestERC20')
    let max = await ethers.BigNumber.from(1).shl(255)
    let token0 = await TestERC20.deploy(max)
    let token1 = await TestERC20.deploy(max)
    await factory.createPool(token0.address, token1.address, 500)
    let Pool = await ethers.getContractFactory('UniswapV3Pool')
    pool = await Pool.attach(await factory.getPool(token0.address, token1.address, 500))
    await pool.initialize(encodePriceSqrt(4000, 1))
    let slot0 = await pool.slot0()
    // 82944
    tickInit = slot0.tick
    // tick spacing is 10
    tick1 = ethers.BigNumber.from(tickInit).div(10).mul(10).sub(1000)
    tick2 = tick1.add(100)
    tick4 = ethers.BigNumber.from(tickInit).div(10).mul(10).add(1000)
    tick3 = tick4.sub(400)
    // tick2 corresponding price
    priceLimit2 = ethers.BigNumber.from('0x3c72dd60cdd223f8f3e2d9de28')
    // tick3 corresponding price
    priceLimit3 = ethers.BigNumber.from('0x41280c85a093f756cd4f3e3527')
    // tick4 corresponding price
    priceLimit4 = ethers.BigNumber.from('0x4278fdc1c457a89eb3729db617')

    let Callee = await ethers.getContractFactory('TestUniswapV3Callee')
    router = await Callee.deploy()
    await token0.approve(router.address, max)
    await token1.approve(router.address, max)
  })
  it('add liquidity at [tick1, tick3] and [tick1, tick4]', async function() {
    await router.mint(pool.address, owner.address, tick1, tick3, liquidity)
    await router.mint(pool.address, owner.address, tick1, tick4, liquidity)
  })
  it('buy, push price to [tick3, tick4]', async function() {
    await router.swapToHigherSqrtPrice(pool.address, priceLimit4.add(priceLimit3).div(2), owner.address)
    let slot0 = await pool.slot0()
    expect(slot0.tick).lt(tick4)
    expect(slot0.tick).gt(tick3)
    let feeGrowthGlobal0X128 = await pool.feeGrowthGlobal0X128()
    let feeGrowthGlobal1X128 = await pool.feeGrowthGlobal1X128()
    console.log(feeGrowthGlobal0X128.toString(), feeGrowthGlobal1X128.toString())
    let tick3Detail = await pool.ticks(tick3)
    console.log(tick3Detail.feeGrowthOutside0X128.toString(), tick3Detail.feeGrowthOutside1X128.toString())
  })
  it('buy, price is [tick3, tick4]', async function() {
    await router.swapToHigherSqrtPrice(pool.address, priceLimit4.sub(1000), owner.address)
    let slot0 = await pool.slot0()
    expect(slot0.tick).lte(tick4)
    expect(slot0.tick).gt(tick3)
    let feeGrowthGlobal0X128 = await pool.feeGrowthGlobal0X128()
    let feeGrowthGlobal1X128 = await pool.feeGrowthGlobal1X128()
    console.log(feeGrowthGlobal0X128.toString(), feeGrowthGlobal1X128.toString())
    let tick3Detail = await pool.ticks(tick3)
    console.log(tick3Detail.feeGrowthOutside0X128.toString(), tick3Detail.feeGrowthOutside1X128.toString())
  })
  it('add liquidity at [tick2, tick3], tick2 is not initialized', async function() {
    let slot0 = await pool.slot0()
    expect(slot0.tick).gt(tick3)
    expect(slot0.tick).gt(tick2)
    await router.mint(pool.address, owner.address, tick2, tick3, liquidity)
    let position = await pool.positions(ethers.utils.solidityKeccak256(['address', 'int24', 'int24'],
      [owner.address, tick2, tick3]))
    // feeGrowthInside1LastX128 should be overflowed
    console.log(position.feeGrowthInside1LastX128.toString())
  })
  it('swap to tick1, and to tick3', async function() {
    // settle fee
    await pool.burn(tick1, tick3, 0)
    await pool.burn(tick1, tick4, 0)
    await router.swapToLowerSqrtPrice(pool.address, priceLimit2.sub(1000), owner.address)
    await router.swapToHigherSqrtPrice(pool.address, priceLimit4.sub(1000), owner.address)
  })
  it('calculate fee of position[tick2, tick3]', async function() {
    let position1_3 = await pool.positions(ethers.utils.solidityKeccak256(['address', 'int24', 'int24'],
      [owner.address, tick1, tick3]))
    let position2_3 = await pool.positions(ethers.utils.solidityKeccak256(['address', 'int24', 'int24'],
      [owner.address, tick2, tick3]))
    console.log(position1_3.tokensOwed1.toString(), position2_3.tokensOwed1.toString())
    // settle fee
    await pool.burn(tick1, tick3, 0)
    await pool.burn(tick1, tick4, 0)
    await pool.burn(tick2, tick3, 0)
    let position1_3_after = await pool.positions(ethers.utils.solidityKeccak256(['address', 'int24', 'int24'],
      [owner.address, tick1, tick3]))
    let position2_3_after = await pool.positions(ethers.utils.solidityKeccak256(['address', 'int24', 'int24'],
      [owner.address, tick2, tick3]))
    console.log(position1_3_after.tokensOwed1.toString(), position2_3_after.tokensOwed1.toString())
    let multiplier = ethers.BigNumber.from(2).shl(128)
    console.log(position1_3_after.tokensOwed1.sub(position1_3.tokensOwed1).mul(multiplier).div(position1_3.liquidity).toString())
    console.log(position2_3_after.tokensOwed1.sub(position2_3.tokensOwed1).mul(multiplier).div(position2_3.liquidity).toString())
  })
})
