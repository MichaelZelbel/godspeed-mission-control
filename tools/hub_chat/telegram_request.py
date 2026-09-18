"""Wrap PTB's supported request interface, including native media and edits."""
import json
from telegram.request import BaseRequest
from telegram.error import Forbidden


class GuardedRequest(BaseRequest):
    def __init__(self, delegate, boundary):
        self.delegate, self.boundary = delegate, boundary

    @property
    def read_timeout(self):
        return self.delegate.read_timeout

    async def initialize(self):
        await self.delegate.initialize()

    async def shutdown(self):
        await self.delegate.shutdown()

    async def do_request(self, url, method, request_data=None, **kwargs):
        operation = url.rsplit('/',1)[-1]
        payload = request_data.parameters if request_data else {}
        if not self.boundary.allowed(operation,payload):
            self.boundary.chat.store.audit('suppressed',operation)
            raise Forbidden('Output has no authorized conversation purpose')
        status,body = await self.delegate.do_request(url=url,method=method,request_data=request_data,**kwargs)
        if status == 200:
            receipt = json.loads(body)
            if receipt.get('ok'):
                self.boundary.record_part(operation,payload,receipt.get('result'))
        return status,body
