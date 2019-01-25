const EventEmitter = require('events');

// Note: as of now only supports trailing the price going up (after 
// a buy), on trigger (when the price moves down) you should sell.


// @param initialPrice: initial price, preferably buy price
// @param trail: fixed offset from the price
// @param onTrigger: fn to call when the stop triggers
class FixedStop extends EventEmitter {
  constructor({stopValue, initialPrice, exposure, onTrigger}) {
    super();

    this.isLive = true;
    this.onTrigger = onTrigger;

    this.initialPrice = initialPrice;
    this.stopValue = stopValue;
    this.exposure = exposure;
  }

  updatePrice(price) {
    this.price = price;
    if(!this.isLive) {
      return;
    }

    if (this.exposure > 0) {
      if(price <= this.initialPrice - this.stopValue) {
        this.trigger();
      }
    }

    if (this.exposure < 0) {
      if(price >= this.initialPrice + this.stopValue) {
        this.trigger();
      }
    }
  }

  trigger() {
    if(!this.isLive) {
      return;
    }

    this.isLive = false;
    if(this.onTrigger) {
      this.onTrigger(this.initialPrice, this.price);
    }
    this.emit('trigger', this.initialPrice);
  }
}

module.exports = FixedStop;
