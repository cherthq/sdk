"""Install, relocate, find_package, compile and run with only installed SDK files."""
import pathlib
import subprocess
import sys
import tarfile
import tempfile

cmake, build = sys.argv[1:]
with tempfile.TemporaryDirectory(prefix="trychert-consumer-") as temporary:
    root = pathlib.Path(temporary)
    # Public distribution identity is separate from CMake/library identity.
    cpack = str(pathlib.Path(cmake).with_name("cpack" + pathlib.Path(cmake).suffix))
    for config in ("CPackSourceConfig.cmake", "CPackConfig.cmake"):
        subprocess.run([cpack, "--config", str(pathlib.Path(build) / config),
                        "-B", str(root / "archives")], check=True)
    archives = list((root / "archives").glob("*.tar.gz"))
    assert len(archives) == 2, archives
    assert all(file.name.startswith("chert-sdk-") for file in archives), archives
    source = next(file for file in archives if file.name.endswith("-Source.tar.gz"))
    binary = next(file for file in archives if file != source)
    with tarfile.open(source) as archive:
        assert any(name.endswith("/include/trychert/client.hpp") for name in archive.getnames())
    with tarfile.open(binary) as archive:
        assert any(name.endswith("/cmake/trychert/trychertConfig.cmake") for name in archive.getnames())
    prefix = root / "original"
    subprocess.run([cmake, "--install", build, "--prefix", str(prefix)], check=True)
    relocated = root / "relocated"
    prefix.rename(relocated)
    # Installed package exports must not refer to the checkout/build tree.
    for file in relocated.rglob("*.cmake"):
        contents = file.read_text()
        assert str(pathlib.Path(build).resolve()) not in contents, file
        assert str(pathlib.Path(__file__).resolve().parents[1]) not in contents, file
    example = relocated / "share" / "trychert" / "examples"
    subprocess.run([cmake, "-S", str(example), "-B", str(root / "build"),
                    f"-DCMAKE_PREFIX_PATH={relocated}"], check=True)
    subprocess.run([cmake, "--build", str(root / "build"), "--parallel", "2"], check=True)
    subprocess.run([str(root / "build" / "trychert-example")], check=True)
