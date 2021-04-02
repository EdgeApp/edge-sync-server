# Installing

To install ab-sync copy the two binaries:

```
cp ab-sync /usr/local/bin
cp libgit2.so.23 /usr/local/lib
```

The default binaries are built for Ubuntu 20.04.

Binaries for alpine 3.13 are included as well. These are used for the docker container as of writing.

# Building

Example build instructions (for Alpine 3.13):

```
apk update
apk add curl git gcc make cmake libtool pkgconfig musl-dev

curl -L -o archive.tar.gz https://github.com/libgit2/libgit2/archive/v0.23.4.tar.gz#02ff3374da7fdf116984adf41749db7b4d0a5877
tar -xf archive.tar.gz
cd libgit2-0.23.4
mkdir -p build
cd build
cmake .. \
  -DBUILD_CLAR:BOOL=FALSE
make
make install

git clone https://github.com/EdgeApp/airbitz-core.git
cd airbitz-core/minilibs/git-sync/
make
chmod 755 sync
mv sync /usr/local/bin/ab-sync
```
