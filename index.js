const net     = require('net');
const events  = require('events');
const assert  = require('assert');
const util    = require('util');
const tool    = require('./lib');
/*
 * desc: socketPool
 * author: mufeng
 */

function ClientPool(option) {
  if (!(this instanceof ClientPool)) return new ClientPool();
  let self = this;
  self.clientList   = [];
  self.taskList     = [];
  self.host         = option.host;
  self.port         = option.port;
  self.readysize    = 0;
  self.minsize      = option.min || 1;
  self.maxsize      = option.max || 10;
  self.timeout      = option.timeout || 30;
  self.cursize      = 0;

  //初始化链接
  self.initConnection();
  //任务事件触发
  self.on('doTask', function() {
    console.log('get doTask event');
    self.doTask();
  });

  //初始化链接超时警告
  let initTimeout = function() {
    clearTimeout(self.initTimer);
    self.initTimer = null;
    delete self.initTimer;
    assert(self.readysize >= self.minsize, 'init connection timeout!!!');
  }
  //初始化超市判断
  self.initTimer = setTimeout(initTimeout, 
    self.timeout * 1000);
}

util.inherits(ClientPool, events.EventEmitter);

//创建链接
ClientPool.prototype.createConnection = function() {
  let self = this;
  if(self.cursize >= self.maxsize){
    console.log("not enough size:", self.cursize, self.maxsize);
    return false;
  }
  var soc = net.createConnection(self.port, self.host);
  self.cursize++;
  soc.socId = tool.guid();
  soc.on('connect', function(){
    self.readysize++;
    self.clientList.push(this);
    self.emit('doTask', null);
  });
  soc.on('close', function(error){
    // connect被关闭了,那么这时候应该主动放弃当前的这个链接,重新创建一个链接出来顶替.
    if(!error) {
      //在客户端连接时触发的close事件不做处理（error事件中已经处理）
      //只处理被服务端主动断开的链接
      this.destroy();
      self.cursize--;
      setTimeout(function() {
        self.createConnection();
      }, 5000);
    }

  });
  soc.on('error', function(e){
    console.log('occour error ' + e.toString());
    //检查clientList中是否包含有error事件的socket
    for(let i = 0; i < self.clientList.length; i++) {
      let soc = self.clientList[i]
      if(soc.socId == this.socId) {
        self.clientList.splice(i, 1);
      }
    }
    this.destroy();
    self.cursize--;
    setTimeout(function() {
      self.createConnection();
    }, 5000);
  });
};
//初始化连接
ClientPool.prototype.initConnection = function() {
  for(var i = 0; i < this.minsize; i++){
    this.createConnection();
  }
}
//判断链接是否可用
ClientPool.prototype.validConnection = function(connection) {
   return (true && connection['readable']) && connection['writable'];
}

//释放连接
ClientPool.prototype.releaseConnection = function(connection) {
  try {
    if(connection._events['close'].length > 1) {
      connection._events['close'].pop();
    }
    if(connection._events['end'].length > 0) {
      connection._events['end'].pop();
    }
    delete connection._events['data'];
    connection._events['data'] = null;
  } catch(e) {
    console.log(e);
  }
  //将链接重新放回空闲队列
  if(connection) {
    this.clientList.push(connection);
    this.emit('doTask', null);
  }

}
//从任务队列取任务， 从连接池取空闲连接做任务
ClientPool.prototype.doTask = function() {
  let self = this;
  //若链接不足 创建链接
  if(this.taskList.length > 0 && this.clientList.length == 0 
    && this.cursize < this.maxsize) {
    self.createConnection();
    return;
  }
  //处理请求
  if(this.taskList.length > 0 && this.clientList.length > 0) {
    let handle = this.taskList.shift();
    let connection = this.clientList.shift();
    //判断链接的有效性
    if(!this.validConnection(connection)) {
      delete connection;
      connection = null;
      this.cursize--;
      this.createConnection();
      return;
    }
    try {
      handle(connection);
    } catch(e) {
      console.log(e);
    }
  }
  //如果任务队列还有任务需要做并且还有空闲链接，在node loop下一个阶段继续取任务执行
  if(this.taskList.length > 0 && this.clientList.length > 0) {
    process.nextTick(function() {
      self.emit('doTask', null);
    });
  }
}

//获取一个空闲链接
ClientPool.prototype.getConnection = function(callback) {
  this.taskList.push(callback);
  this.emit('doTask', null)
}

exports.Pool = function(config) {
  return new ClientPool(config);
}