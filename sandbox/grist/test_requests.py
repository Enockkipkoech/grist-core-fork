# coding=utf-8
import unittest

import test_engine
import testutil
from functions import CaseInsensitiveDict, Response, HTTPError


class TestCaseInsensitiveDict(unittest.TestCase):
  def test_case_insensitive_dict(self):
    d = CaseInsensitiveDict({"FOO": 1})
    for key in ["foo", "FOO", "Foo"]:
      self.assertEqual(d, {"foo": 1})
      self.assertEqual(list(d), ["foo"])
      self.assertEqual(d, CaseInsensitiveDict({key: 1}))
      self.assertIn(key, d)
      self.assertEqual(d[key], 1)
      self.assertEqual(d.get(key), 1)
      self.assertEqual(d.get(key, 2), 1)
      self.assertEqual(d.get(key + "2", 2), 2)
      self.assertEqual(d.pop(key), 1)
      self.assertEqual(d, {})
      self.assertEqual(d.setdefault(key, 3), 3)
      self.assertEqual(d, {"foo": 3})
      self.assertEqual(d.setdefault(key, 4), 3)
      self.assertEqual(d, {"foo": 3})
      del d[key]
      self.assertEqual(d, {})
      d[key] = 1


class TestResponse(unittest.TestCase):
  def test_ok_response(self):
    r = Response(b"foo", 200, "OK", {"X-header": "hi"}, None)
    self.assertEqual(r.content, b"foo")
    self.assertEqual(r.text, u"foo")
    self.assertEqual(r.status_code, 200)
    self.assertEqual(r.ok, True)
    self.assertEqual(r.reason, "OK")
    self.assertEqual(r.headers, {"x-header": "hi"})
    self.assertEqual(r.encoding, "ascii")
    self.assertEqual(r.apparent_encoding, "ascii")
    r.raise_for_status()
    r.close()

  def test_error_response(self):
    r = Response(b"foo", 500, "Server error", {}, None)
    self.assertEqual(r.status_code, 500)
    self.assertEqual(r.ok, False)
    self.assertEqual(r.reason, "Server error")
    with self.assertRaises(HTTPError) as cm:
      r.raise_for_status()
    self.assertEqual(str(cm.exception), "Request failed with status 500")

  def test_json(self):
    r = Response(b'{"foo": "bar"}', 200, "OK", {}, None)
    self.assertEqual(r.json(), {"foo": "bar"})

  def test_encoding_direct(self):
    r = Response(b"foo", 200, "OK", {}, "some encoding")
    self.assertEqual(r.encoding, "some encoding")
    self.assertEqual(r.apparent_encoding, "ascii")

  def test_apparent_encoding(self):
    text = u"编程"
    encoding = "utf-8"
    content = text.encode(encoding)
    self.assertEqual(content.decode(encoding), text)
    r = Response(content, 200, "OK", {}, "")
    self.assertEqual(r.encoding, encoding)
    self.assertEqual(r.apparent_encoding, encoding)
    self.assertEqual(r.content, content)
    self.assertEqual(r.text, text)


class TestRequestFunction(test_engine.EngineTestCase):
  sample = testutil.parse_test_sample({
    "SCHEMA": [
      [1, "Table1", [
        [2, "Request", "Any", True, "$id", "", ""],
        [3, "Other", "Any", True, "", "", ""],
      ]],
    ],
    "DATA": {
      "Table1": [
        ["id"],
        [1],
        [2],
      ],
    }
  })

  def test_request_function(self):
    self.load_sample(self.sample)

    formula = """
r = REQUEST('my_url', headers={'foo': 'bar'}, params={'b': 1, 'a': 2})
r.__dict__
"""
    out_actions = self.modify_column("Table1", "Request", formula=formula)
    key = '9d305be9664924aaaf7ebb0bab2e4155d1fa1b9dcde53e417f1a9f9a2c7e09b9'
    deps = {'Table1': {'Request': [1, 2]}}
    args = {
      'url': 'my_url',
      'headers': {'foo': 'bar'},
      'params': {'a': 2, 'b': 1},
      'deps': deps,
    }
    self.assertEqual(out_actions.requests, {key: args})
    self.assertTableData("Table1", cols="subset", data=[
      ["id", "Request"],
      [1, 1],
      [2, 2],
    ])

    response = {
      'status': 200,
      'statusText': 'OK',
      'content': b'body',
      'headers': {'h1': 'h2'},
      'encoding': 'utf16',
      'deps': deps,
    }
    self.apply_user_action(["RespondToRequests", {key: response.copy()}, [key]])

    # Translate names from JS `fetch` API to Python `requests`-style API
    response["status_code"] = response.pop("status")
    response["reason"] = response.pop("statusText")
    # This is sent in the user action but not kept for the response object
    del response["deps"]

    self.assertTableData("Table1", cols="subset", data=[
      ["id", "Request"],
      [1, response],
      [2, response],
    ])
