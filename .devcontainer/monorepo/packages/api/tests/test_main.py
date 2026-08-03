from api.main import main


def test_main() -> None:
    assert main() == "hello from api"
